import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import {
  UserRole,
  type Clinic,
  type Guardian,
  type GuardianChild,
  type GuardianDetail,
  type IssuedClaimCode,
  type Paginated,
} from '@clinic/contracts';
import { isPhoneRegion, type PhoneRegion } from '@clinic/phone';
import { ChildService } from '../child.service';
import { ClaimCodeService } from '../claim-code.service';
import { GuardianService } from '../guardian.service';
import { PatientsError, PatientsErrorCode } from '../patients.errors';
import {
  CreateClinicChildDto,
  CreateClinicGuardianDto,
  GuardianSearchQueryDto,
  UpdateClinicChildDto,
  UpdateClinicGuardianDto,
} from './clinic-guardians.dto';
import { PatientsExceptionFilter } from './patients-exception.filter';

/**
 * Reception's view of a family.
 *
 * This is the identity half of the desk: find the caller, open their children,
 * create either if the clinic has not met them, and hand out a claim code when
 * a parent wants the app. Booking builds on it later; nothing clinical does.
 *
 * **The clinic is never a parameter.** No route here accepts a `clinicId` in a
 * path, a query or a body — it comes from `@CurrentMember()`, which the guard
 * resolved from the token. That is what makes one clinic unable to read
 * another's families, and it is why `clinicId` is absent from every DTO: with
 * `forbidNonWhitelisted`, sending one is a 400 rather than something a
 * controller has to remember to ignore.
 *
 * Reads are open to any active member; a doctor legitimately needs to look up
 * the family of the child in front of them. Writes are reception and admin.
 */
@Controller({ path: 'clinic/guardians', version: '1' })
@UseFilters(PatientsExceptionFilter)
export class ClinicGuardiansController {
  constructor(
    private readonly guardians: GuardianService,
    private readonly children: ChildService,
    private readonly claims: ClaimCodeService,
    private readonly clinics: ClinicService,
  ) {}

  /**
   * Find a family, by the number on the caller ID or by name.
   *
   * A phone typed as `0101 234 5678` finds the guardian stored as
   * `+201012345678`: the domain normalises through `@clinic/phone`, so the
   * receptionist types what they see rather than what the database holds.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get()
  async search(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: GuardianSearchQueryDto,
  ): Promise<Paginated<Guardian>> {
    const clinic = await this.clinicOf(member);
    return this.guardians.search(member.clinicId, {
      phone: query.phone,
      region: regionOf(clinic),
      query: query.q,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** The family behind one guardian: who they are, and which children. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get(':guardianId')
  async detail(
    @CurrentMember() member: ClinicMemberContext,
    @Param('guardianId', new ParseUUIDPipe()) guardianId: string,
  ): Promise<GuardianDetail> {
    const guardian = await this.requireGuardian(member.clinicId, guardianId);
    const children = await this.children.listForGuardian(
      member.clinicId,
      guardianId,
    );
    return { guardian, children };
  }

  /**
   * Register a family the clinic has just met.
   *
   * No account is created and none is required — `auth_user_id` stays null, and
   * the family is bookable and servable from this moment. That is the whole
   * point of the reception path.
   *
   * A phone the clinic already knows comes back as a conflict carrying the
   * existing guardian, so the screen can offer to open that family rather than
   * nudging a receptionist into creating a second record for the same person.
   * The conflict is decided by the unique index, after the attempt, so two
   * receptionists taking the same call cannot both succeed.
   */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post()
  async create(
    @CurrentMember() member: ClinicMemberContext,
    @Body() body: CreateClinicGuardianDto,
  ): Promise<Guardian> {
    const clinic = await this.clinicOf(member);

    try {
      return await this.guardians.create({
        clinicId: member.clinicId,
        region: regionOf(clinic),
        fullName: body.fullName,
        phone: body.phone,
        email: body.email ?? null,
        defaultRelationship: body.relationship ?? null,
        createdByMemberId: member.id,
      });
    } catch (error) {
      if (
        error instanceof PatientsError &&
        error.code === PatientsErrorCode.GuardianPhoneTaken
      ) {
        throw await this.conflictWithExisting(clinic, member, body.phone);
      }
      throw error;
    }
  }

  @Roles(UserRole.Reception, UserRole.Admin)
  @Patch(':guardianId')
  async update(
    @CurrentMember() member: ClinicMemberContext,
    @Param('guardianId', new ParseUUIDPipe()) guardianId: string,
    @Body() body: UpdateClinicGuardianDto,
  ): Promise<Guardian> {
    const clinic = await this.clinicOf(member);
    return this.guardians.update(member.clinicId, guardianId, {
      fullName: body.fullName,
      phone: body.phone,
      region: regionOf(clinic),
      email: body.email,
      defaultRelationship: body.relationship,
    });
  }

  /**
   * Add a child to a family.
   *
   * The child and the link are one unit of work: a child with no guardian is
   * invisible to every parent-facing query and to reception's own family view,
   * so committing one without the other would strand it.
   */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post(':guardianId/children')
  async createChild(
    @CurrentMember() member: ClinicMemberContext,
    @Param('guardianId', new ParseUUIDPipe()) guardianId: string,
    @Body() body: CreateClinicChildDto,
  ): Promise<GuardianChild> {
    // Confirms the guardian is this clinic's before anything is written. A
    // guardian at another clinic reads as "no such guardian".
    await this.requireGuardian(member.clinicId, guardianId);

    return this.children.createForGuardianLinked({
      clinicId: member.clinicId,
      guardianId,
      fullName: body.fullName,
      dateOfBirth: body.dateOfBirth ?? null,
      sex: body.sex ?? null,
      relationship: body.relationship ?? 'other',
      isPrimary: body.isPrimary ?? false,
      createdByMemberId: member.id,
    });
  }

  /**
   * Issue a code that lets a parent claim this family on their phone.
   *
   * The plaintext is in this response and nowhere else — only a keyed HMAC is
   * stored, so it cannot be looked up again and a lost code is reissued rather
   * than recovered. Nothing is sent anywhere: reception reads it out on the
   * call or hands it over at the desk. No SMS, no email, no OTP.
   *
   * The TTL, the single-use rule and the attempt limit all live in
   * `ClaimCodeService`; this endpoint adds no cryptography of its own.
   */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post(':guardianId/claim-code')
  async issueClaimCode(
    @CurrentMember() member: ClinicMemberContext,
    @Param('guardianId', new ParseUUIDPipe()) guardianId: string,
  ): Promise<IssuedClaimCode> {
    return this.claims.issue(member.clinicId, guardianId, member.id);
  }

  private async requireGuardian(
    clinicId: string,
    guardianId: string,
  ): Promise<Guardian> {
    const guardian = await this.guardians.findById(clinicId, guardianId);
    if (guardian === null) {
      throw new PatientsError(
        PatientsErrorCode.GuardianNotFound,
        'No such guardian at this clinic.',
      );
    }
    return guardian;
  }

  /**
   * Turn a duplicate-phone conflict into something the screen can act on.
   *
   * Looked up after the failed insert rather than checked before it: a check
   * beforehand is a race two receptionists can both pass, and the unique index
   * is the only thing that actually decides.
   *
   * The existing guardian is included because the caller is staff at this
   * clinic, who could find the same record by searching that number a moment
   * later. The parent-facing path deliberately carries no such detail.
   */
  private async conflictWithExisting(
    clinic: Clinic,
    member: ClinicMemberContext,
    phone: string,
  ): Promise<PatientsError> {
    const existing = await this.guardians.findByPhone(
      member.clinicId,
      phone,
      regionOf(clinic),
    );
    return new PatientsError(
      PatientsErrorCode.GuardianPhoneTaken,
      'A guardian with that phone number already exists at this clinic.',
      undefined,
      existing === null ? undefined : { guardian: existing },
    );
  }

  private async clinicOf(member: ClinicMemberContext): Promise<Clinic> {
    const clinic = await this.clinics.findById(member.clinicId);
    if (clinic === null) {
      throw new Error(`Clinic ${member.clinicId} is missing or inactive.`);
    }
    return clinic;
  }
}

/**
 * Children are addressed on their own path rather than under a guardian.
 *
 * A child has several guardians, so `/guardians/:id/children/:childId` would
 * imply an ownership that does not exist and invite a caller to think the
 * guardian in the path determines what may be edited. The clinic from the token
 * is what scopes this.
 */
@Controller({ path: 'clinic/children', version: '1' })
@UseFilters(PatientsExceptionFilter)
export class ClinicChildrenController {
  constructor(private readonly children: ChildService) {}

  @Roles(UserRole.Reception, UserRole.Admin)
  @Patch(':childId')
  updateChild(
    @CurrentMember() member: ClinicMemberContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @Body() body: UpdateClinicChildDto,
  ) {
    return this.children.update(member.clinicId, childId, {
      fullName: body.fullName,
      dateOfBirth: body.dateOfBirth,
      sex: body.sex,
    });
  }
}

/**
 * The region a clinic's phone numbers are read against.
 *
 * An unmodelled country code is a configuration error rather than a request
 * error, so it fails loudly instead of quietly normalising against the wrong
 * country and filing a family under a number nobody can find.
 */
function regionOf(clinic: Clinic): PhoneRegion {
  if (!isPhoneRegion(clinic.defaultCountryCode)) {
    throw new Error(
      `Clinic ${clinic.slug} has an unsupported country code ` +
        `"${clinic.defaultCountryCode}".`,
    );
  }
  return clinic.defaultCountryCode;
}

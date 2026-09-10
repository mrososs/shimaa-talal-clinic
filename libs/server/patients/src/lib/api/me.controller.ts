import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  CurrentGuardian,
  CurrentUser,
  Roles,
  ServerConfigService,
  type AuthenticatedUser,
  type GuardianContext,
} from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import {
  UserRole,
  type ClaimRequestResponse,
  type Clinic,
  type Guardian,
  type GuardianChild,
  type MeResponse,
} from '@clinic/contracts';
import {
  isPhoneRegion,
  normalizeToE164,
  type PhoneRegion,
} from '@clinic/phone';
import { ChildService } from '../child.service';
import { ClaimCodeService } from '../claim-code.service';
import { GuardianOwnershipService } from '../guardian-ownership.service';
import { GuardianService } from '../guardian.service';
import { PatientsError, PatientsErrorCode } from '../patients.errors';
import {
  ClaimDto,
  ClaimRequestDto,
  CreateChildDto,
  CreateGuardianDto,
  UpdateChildDto,
  UpdateGuardianDto,
} from './me.dto';
import { PatientsExceptionFilter } from './patients-exception.filter';

/**
 * A parent, acting for their own family.
 *
 * Everything here is scoped by the caller's own identity. No route takes a
 * `clinicId` or a `guardianId`: both come from the token, because a parameter
 * a client can set is a parameter a client can change.
 *
 * The split in authorisation is deliberate. `/me` and the claim routes require
 * only authentication, because a signed-in user with no guardian is a normal
 * onboarding state and those routes exist to move them out of it. Everything
 * else requires `@Roles(UserRole.Guardian)`, which is also what makes
 * `@CurrentGuardian()` non-null.
 */
@Controller({ path: 'me', version: '1' })
@UseFilters(PatientsExceptionFilter)
export class MeController {
  constructor(
    private readonly guardians: GuardianService,
    private readonly children: ChildService,
    private readonly ownership: GuardianOwnershipService,
    private readonly claims: ClaimCodeService,
    private readonly clinics: ClinicService,
    private readonly config: ServerConfigService,
  ) {}

  /**
   * Everything the app needs to decide what to render first.
   *
   * `guardian: null` is an answer, not an error — it is how the app knows to
   * route to onboarding rather than home.
   */
  @Get()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const guardian = await this.guardians.findByAuthUserId(user.id);
    const clinic =
      guardian === null
        ? await this.deploymentClinic()
        : await this.requireClinic(guardian.clinicId);

    const children =
      guardian === null
        ? []
        : await this.children.listForGuardian(clinic.id, guardian.id);

    return {
      authUserId: user.id,
      email: user.email,
      clinic,
      guardian,
      children,
    };
  }

  /** Onboarding: become a guardian at the clinic this deployment serves. */
  @Post('guardian')
  async createGuardian(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateGuardianDto,
  ): Promise<Guardian> {
    const existing = await this.guardians.findByAuthUserId(user.id);
    if (existing !== null) {
      throw new PatientsError(
        PatientsErrorCode.AuthUserAlreadyLinked,
        'This account already belongs to a guardian.',
      );
    }

    const clinic = await this.deploymentClinic();
    this.assertVerifiedPhone(user, body.phone, clinic);

    // One INSERT, not a create followed by a link: a guardian committed
    // without its account would be unreachable by the person who just
    // registered, and indistinguishable from a family reception had entered.
    return this.guardians.createSelfRegistered(
      {
        clinicId: clinic.id,
        region: regionOf(clinic),
        fullName: body.fullName,
        phone: body.phone,
        email: body.email ?? null,
        defaultRelationship: body.relationship ?? null,
      },
      user.id,
    );
  }

  @Roles(UserRole.Guardian)
  @Patch('guardian')
  async updateGuardian(
    @CurrentGuardian() guardian: GuardianContext,
    @Body() body: UpdateGuardianDto,
  ): Promise<Guardian> {
    const clinic = await this.requireClinic(guardian.clinicId);
    return this.guardians.update(clinic.id, guardian.id, {
      fullName: body.fullName,
      phone: body.phone,
      region: regionOf(clinic),
      email: body.email,
    });
  }

  /**
   * "Do you already know this number?"
   *
   * Answers with a boolean and nothing else. Returning a name or a child count
   * would turn a guess at a phone number into a way to read a family's details,
   * and a number already linked to an account reports `false` too — so a match
   * and a non-match are indistinguishable except where the answer is useful.
   */
  @Post('guardian/claim-request')
  @HttpCode(HttpStatus.OK)
  async claimRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ClaimRequestDto,
  ): Promise<ClaimRequestResponse> {
    const clinic = await this.deploymentClinic();
    this.assertVerifiedPhone(user, body.phone, clinic);
    const matchFound = await this.claims.hasUnclaimedGuardianForPhone(
      clinic.id,
      body.phone,
      regionOf(clinic),
    );
    return { matchFound };
  }

  /**
   * Link this account to a family the clinic already knows.
   *
   * A matching phone number grants nothing on its own. Phone OTP proves control
   * of the number, while the clinic-issued code separately authorises linking
   * the existing medical family to this auth account.
   */
  @Post('guardian/claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ClaimDto,
  ): Promise<Guardian> {
    const clinic = await this.deploymentClinic();
    this.assertVerifiedPhone(user, body.phone, clinic);
    const target = await this.guardians.findByPhone(
      clinic.id,
      body.phone,
      regionOf(clinic),
    );

    // An unknown number and an already-claimed one fail identically. Saying
    // "that family is already registered" would confirm the number belongs to
    // someone, which is the thing this must not reveal.
    if (target === null || target.hasAccount) {
      throw new PatientsError(
        PatientsErrorCode.ClaimCodeInvalid,
        'That code is not valid.',
      );
    }

    return this.claims.claim({
      clinicId: clinic.id,
      guardianId: target.id,
      code: body.code,
      authUserId: user.id,
    });
  }

  @Roles(UserRole.Guardian)
  @Get('children')
  listChildren(
    @CurrentGuardian() guardian: GuardianContext,
  ): Promise<GuardianChild[]> {
    return this.children.listForGuardian(guardian.clinicId, guardian.id);
  }

  @Roles(UserRole.Guardian)
  @Post('children')
  createChild(
    @CurrentGuardian() guardian: GuardianContext,
    @Body() body: CreateChildDto,
  ): Promise<GuardianChild> {
    return this.children.createForGuardianLinked({
      clinicId: guardian.clinicId,
      guardianId: guardian.id,
      fullName: body.fullName,
      dateOfBirth: body.dateOfBirth ?? null,
      sex: body.sex ?? null,
      relationship: body.relationship ?? 'other',
    });
  }

  @Roles(UserRole.Guardian)
  @Patch('children/:childId')
  async updateChild(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @Body() body: UpdateChildDto,
  ): Promise<GuardianChild> {
    // Ownership first, and it reports "no such child" rather than "not yours" —
    // the difference between those answers is itself information about somebody
    // else's patient.
    await this.ownership.assertCanAccessChild(
      guardian.clinicId,
      guardian.id,
      childId,
    );

    await this.children.update(guardian.clinicId, childId, {
      fullName: body.fullName,
      dateOfBirth: body.dateOfBirth,
      sex: body.sex,
    });

    const listed = await this.children.listForGuardian(
      guardian.clinicId,
      guardian.id,
    );
    const updated = listed.find((child) => child.id === childId);
    if (updated === undefined) {
      throw new PatientsError(
        PatientsErrorCode.ChildNotFound,
        'No such child at this clinic.',
      );
    }
    return updated;
  }

  /** The clinic a parent with no guardian yet is joining. */
  private async deploymentClinic(): Promise<Clinic> {
    const slug = this.config.clinic.slug;
    const clinic = await this.clinics.findBySlug(slug);
    if (clinic === null) {
      // Misconfiguration, not a client error: CLINIC_SLUG names a clinic that
      // does not exist or is inactive.
      throw new Error(`CLINIC_SLUG "${slug}" does not match an active clinic.`);
    }
    return clinic;
  }

  private async requireClinic(clinicId: string): Promise<Clinic> {
    const clinic = await this.clinics.findById(clinicId);
    if (clinic === null) {
      throw new Error(`Clinic ${clinicId} is missing or inactive.`);
    }
    return clinic;
  }

  /** Phone-auth sessions may only onboard or claim the number they proved. */
  private assertVerifiedPhone(
    user: AuthenticatedUser,
    submittedPhone: string,
    clinic: Clinic,
  ): void {
    if (user.phone === null) return;

    const normalized = normalizeToE164(submittedPhone, regionOf(clinic));
    if (normalized === null) {
      throw new PatientsError(
        PatientsErrorCode.InvalidPhone,
        'The phone number is not valid for this clinic.',
      );
    }
    if (normalized !== user.phone) {
      throw new PatientsError(
        PatientsErrorCode.VerifiedPhoneMismatch,
        'Use the phone number verified by this auth session.',
      );
    }
  }
}

/**
 * The region a clinic's phone numbers are read against.
 *
 * A clinic whose country code the phone library does not model is a
 * configuration error rather than a request error, so it fails loudly instead
 * of silently normalising against the wrong country.
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

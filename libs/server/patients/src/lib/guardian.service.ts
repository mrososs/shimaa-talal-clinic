import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type SqlExecutor,
  type QueryResultRow,
} from '@clinic/server-core';
import {
  normalizePageRequest,
  type Guardian,
  type GuardianRelationship,
  type Paginated,
} from '@clinic/contracts';
import { normalizeToE164, type PhoneRegion } from '@clinic/phone';
import {
  PatientsError,
  PatientsErrorCode,
  isUniqueViolation,
} from './patients.errors';

export interface CreateGuardianInput {
  clinicId: string;
  /** Region the phone is read against. See the note on phone handling below. */
  region: PhoneRegion;
  fullName: string;
  /** Anything a person might type; stored normalised, with the original kept. */
  phone: string;
  email?: string | null;
  defaultRelationship?: GuardianRelationship | null;
  /** `null` when the guardian registered themselves. */
  createdByMemberId?: string | null;
}

export interface UpdateGuardianInput {
  fullName?: string;
  phone?: string;
  region?: PhoneRegion;
  email?: string | null;
  defaultRelationship?: GuardianRelationship | null;
}

export interface GuardianSearchInput {
  /** Matched exactly, after normalisation. The receptionist's primary tool. */
  phone?: string;
  region?: PhoneRegion;
  /** Case-insensitive name fragment. */
  query?: string;
  page?: number;
  pageSize?: number;
}

/** How an account came to be linked, for the audit trail. */
export type GuardianClaimMethod = 'claim_code' | 'self_signup' | 'phone_otp';

interface GuardianRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  full_name: string;
  phone_e164: string;
  email: string | null;
  auth_user_id: string | null;
  created_at: Date | string;
}

/**
 * The projection this service reads, in the two forms it is needed: aliased for
 * SELECT, bare for RETURNING. Written out rather than derived, so neither can
 * drift and neither depends on a string rewrite.
 *
 * `email` is citext; casting to text keeps the driver from surfacing it as an
 * unfamiliar type.
 */
const SELECT_COLUMNS =
  'g.id, g.clinic_id, g.full_name, g.phone_e164, g.email::text as email, ' +
  'g.auth_user_id, g.created_at';
const RETURNING_COLUMNS =
  'id, clinic_id, full_name, phone_e164, email::text as email, ' +
  'auth_user_id, created_at';

/**
 * Guardians — parents and caregivers, as the clinic knows them.
 *
 * Two properties shape everything here.
 *
 * **A guardian need not have an account.** Reception creates families for
 * people who have never opened the app, and those families must be findable,
 * bookable and servable. `auth_user_id` stays null and nothing may require it.
 *
 * **Phone is the lookup key.** A receptionist types `0101 234 5678` on a call
 * and must land on `+201012345678`. Normalisation runs through `@clinic/phone`,
 * the single implementation, and it is applied here rather than trusted from
 * the caller — a lookup key that depends on every caller remembering to
 * normalise is not a key.
 *
 * The region is a parameter rather than something this service reads from the
 * clinic row. Patients does not own `clinic.clinics`, and reaching into another
 * library's table is the coupling the module boundaries exist to prevent. When
 * `ClinicService` lands, callers will pass `clinic.defaultCountryCode`.
 *
 * Every query is scoped by `clinic_id`. The RLS policy on these tables admits
 * the API role wholesale; it is a backstop against a leaked role, not the
 * tenant boundary. The tenant boundary is the predicate in each statement here.
 */
@Injectable()
export class GuardianService {
  constructor(private readonly database: DatabaseService) {}

  async findById(
    clinicId: string,
    guardianId: string,
    db: SqlExecutor = this.database,
  ): Promise<Guardian | null> {
    const result = await db.query<GuardianRow>(
      `select ${SELECT_COLUMNS}
         from clinic.guardians g
        where g.id = $1 and g.clinic_id = $2`,
      [guardianId, clinicId],
    );
    return result.rows[0] ? toGuardian(result.rows[0]) : null;
  }

  async findByPhone(
    clinicId: string,
    phone: string,
    region: PhoneRegion,
    db: SqlExecutor = this.database,
  ): Promise<Guardian | null> {
    const phoneE164 = this.requireE164(phone, region);
    const result = await db.query<GuardianRow>(
      `select ${SELECT_COLUMNS}
         from clinic.guardians g
        where g.clinic_id = $1 and g.phone_e164 = $2`,
      [clinicId, phoneE164],
    );
    return result.rows[0] ? toGuardian(result.rows[0]) : null;
  }

  /**
   * Resolve a guardian from the signed-in user.
   *
   * The one read here that is deliberately **not** clinic-scoped: at sign-in
   * the API holds a token and nothing else, and learns the clinic *from* this
   * row. `guardians_auth_user_idx` exists for exactly this lookup.
   *
   * `null` is a normal answer — a signed-in user who has not yet onboarded.
   */
  async findByAuthUserId(
    authUserId: string,
    db: SqlExecutor = this.database,
  ): Promise<Guardian | null> {
    const result = await db.query<GuardianRow>(
      `select ${SELECT_COLUMNS}
         from clinic.guardians g
        where g.auth_user_id = $1`,
      [authUserId],
    );
    return result.rows[0] ? toGuardian(result.rows[0]) : null;
  }

  /**
   * Reception's search. Phone matches exactly after normalisation; a name
   * fragment matches case-insensitively.
   */
  async search(
    clinicId: string,
    input: GuardianSearchInput,
    db: SqlExecutor = this.database,
  ): Promise<Paginated<Guardian>> {
    const { page, pageSize } = normalizePageRequest(input);

    const conditions = ['g.clinic_id = $1'];
    const params: unknown[] = [clinicId];

    if (input.phone !== undefined && input.phone.trim() !== '') {
      if (input.region === undefined) {
        throw new PatientsError(
          PatientsErrorCode.InvalidPhone,
          'A region is required to search by phone.',
        );
      }
      params.push(this.requireE164(input.phone, input.region));
      conditions.push(`g.phone_e164 = $${params.length}`);
    }

    if (input.query !== undefined && input.query.trim() !== '') {
      params.push(`%${input.query.trim()}%`);
      conditions.push(`g.full_name ilike $${params.length}`);
    }

    const where = conditions.join(' and ');

    const totalResult = await db.query<{ total: string }>(
      `select count(*)::text as total from clinic.guardians g where ${where}`,
      params,
    );
    const total = Number(totalResult.rows[0]?.total ?? '0');

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.query<GuardianRow>(
      `select ${SELECT_COLUMNS}
         from clinic.guardians g
        where ${where}
        order by g.full_name asc, g.id asc
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );

    return {
      items: rows.rows.map(toGuardian),
      meta: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Create a guardian, with no account attached.
   *
   * A duplicate phone is reported, never silently merged or duplicated: the
   * unique index decides, so two concurrent creates cannot both win.
   */
  async create(
    input: CreateGuardianInput,
    db: SqlExecutor = this.database,
  ): Promise<Guardian> {
    const phoneE164 = this.requireE164(input.phone, input.region);

    try {
      const result = await db.query<GuardianRow>(
        `insert into clinic.guardians
           (clinic_id, full_name, phone_e164, phone_raw, email,
            default_relationship, created_by_member_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning ${RETURNING_COLUMNS}`,
        [
          input.clinicId,
          input.fullName.trim(),
          phoneE164,
          input.phone,
          input.email ?? null,
          input.defaultRelationship ?? null,
          input.createdByMemberId ?? null,
        ],
      );
      return toGuardian(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error, 'guardians_clinic_phone_uq')) {
        throw new PatientsError(
          PatientsErrorCode.GuardianPhoneTaken,
          'A guardian with that phone number already exists at this clinic.',
          error,
        );
      }
      throw error;
    }
  }

  async update(
    clinicId: string,
    guardianId: string,
    input: UpdateGuardianInput,
    db: SqlExecutor = this.database,
  ): Promise<Guardian> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (input.fullName !== undefined) {
      params.push(input.fullName.trim());
      assignments.push(`full_name = $${params.length}`);
    }
    if (input.phone !== undefined) {
      if (input.region === undefined) {
        throw new PatientsError(
          PatientsErrorCode.InvalidPhone,
          'A region is required to change a phone number.',
        );
      }
      params.push(this.requireE164(input.phone, input.region));
      assignments.push(`phone_e164 = $${params.length}`);
      params.push(input.phone);
      assignments.push(`phone_raw = $${params.length}`);
    }
    if (input.email !== undefined) {
      params.push(input.email);
      assignments.push(`email = $${params.length}`);
    }
    if (input.defaultRelationship !== undefined) {
      params.push(input.defaultRelationship);
      assignments.push(`default_relationship = $${params.length}`);
    }

    if (assignments.length === 0) {
      const current = await this.findById(clinicId, guardianId, db);
      if (current === null) {
        throw notFound(guardianId);
      }
      return current;
    }

    params.push(guardianId, clinicId);
    try {
      const result = await db.query<GuardianRow>(
        `update clinic.guardians
            set ${assignments.join(', ')}
          where id = $${params.length - 1} and clinic_id = $${params.length}
          returning ${RETURNING_COLUMNS}`,
        params,
      );
      if (result.rows[0] === undefined) {
        throw notFound(guardianId);
      }
      return toGuardian(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error, 'guardians_clinic_phone_uq')) {
        throw new PatientsError(
          PatientsErrorCode.GuardianPhoneTaken,
          'A guardian with that phone number already exists at this clinic.',
          error,
        );
      }
      throw error;
    }
  }

  /**
   * Link a guardian to a signed-in account.
   *
   * `auth_user_id is null` is part of the WHERE clause, not a check performed
   * beforehand. That is what makes two people claiming the same guardian at the
   * same moment resolve to exactly one winner: the second update matches no row.
   */
  async linkAuthUser(
    clinicId: string,
    guardianId: string,
    authUserId: string,
    via: GuardianClaimMethod,
    db: SqlExecutor = this.database,
  ): Promise<Guardian> {
    let result;
    try {
      result = await db.query<GuardianRow>(
        `update clinic.guardians
            set auth_user_id = $1, claimed_at = now(), claimed_via = $2
          where id = $3 and clinic_id = $4 and auth_user_id is null
          returning ${RETURNING_COLUMNS}`,
        [authUserId, via, guardianId, clinicId],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'guardians_clinic_auth_user_uq')) {
        throw new PatientsError(
          PatientsErrorCode.AuthUserAlreadyLinked,
          'This account is already linked to a guardian at this clinic.',
          error,
        );
      }
      throw error;
    }

    if (result.rows[0] !== undefined) {
      return toGuardian(result.rows[0]);
    }

    // No row matched. Either the guardian does not exist here, or somebody
    // already claimed it — tell those apart, because they are different
    // problems for whoever is looking at the screen.
    const existing = await this.findById(clinicId, guardianId, db);
    if (existing === null) {
      throw notFound(guardianId);
    }
    throw new PatientsError(
      PatientsErrorCode.GuardianAlreadyClaimed,
      'That guardian is already linked to an account.',
    );
  }

  private requireE164(phone: string, region: PhoneRegion): string {
    const normalized = normalizeToE164(phone, region);
    if (normalized === null) {
      throw new PatientsError(
        PatientsErrorCode.InvalidPhone,
        'That phone number could not be read.',
      );
    }
    return normalized;
  }
}

function notFound(guardianId: string): PatientsError {
  return new PatientsError(
    PatientsErrorCode.GuardianNotFound,
    `No guardian ${guardianId} at this clinic.`,
  );
}

/**
 * Row to wire shape.
 *
 * `auth_user_id` becomes `hasAccount`. A client needs to know whether to offer
 * a claim code; it has no use for the identifier, and not sending it is one
 * fewer thing to leak.
 */
function toGuardian(row: GuardianRow): Guardian {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    fullName: row.full_name,
    phoneE164: row.phone_e164,
    email: row.email,
    hasAccount: row.auth_user_id !== null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

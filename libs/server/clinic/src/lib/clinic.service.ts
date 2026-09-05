import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type { Clinic } from '@clinic/contracts';

interface ClinicRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_country_code: string;
  grace_period_minutes: number;
  max_self_defers: number;
  auto_confirm_parent_bookings: boolean;
  today: string;
}

/**
 * `today` is computed by the server, in the clinic's own zone.
 *
 * The clinic's day boundary is its own — Africa/Cairo for the pilot — never the
 * API host's and never the viewer's. At 22:30 UTC it is already tomorrow in
 * Cairo, so a caller deriving "today" from its own clock would ask for the
 * wrong day's appointments for three hours every night.
 */
const CLINIC_COLUMNS = `
  id, name, slug, timezone, default_country_code,
  grace_period_minutes, max_self_defers, auto_confirm_parent_bookings,
  (now() at time zone timezone)::date::text as today
`;

/**
 * Clinic identity and the policy every other domain needs to read.
 *
 * Deliberately narrow: it answers "what are this clinic's settings", nothing
 * about when it is open. Schedules and sessions are a separate concern and a
 * separate task; nothing here anticipates them.
 */
@Injectable()
export class ClinicService {
  constructor(private readonly database: DatabaseService) {}

  async findById(
    clinicId: string,
    db: SqlExecutor = this.database,
  ): Promise<Clinic | null> {
    const result = await db.query<ClinicRow>(
      `select ${CLINIC_COLUMNS} from clinic.clinics where id = $1 and active`,
      [clinicId],
    );
    return result.rows[0] ? toClinic(result.rows[0]) : null;
  }

  /** Used by bootstrap and tooling, which know a clinic by name, not by id. */
  async findBySlug(
    slug: string,
    db: SqlExecutor = this.database,
  ): Promise<Clinic | null> {
    const result = await db.query<ClinicRow>(
      `select ${CLINIC_COLUMNS} from clinic.clinics where slug = $1 and active`,
      [slug],
    );
    return result.rows[0] ? toClinic(result.rows[0]) : null;
  }

  /**
   * The operating rules other domains enforce on the clinic's behalf.
   *
   * Separate from `findById` because these are not for clients. `Clinic` is a
   * contract a browser receives; these are numbers Booking applies and nobody
   * renders — a cancellation cutoff is a rule, not a label.
   *
   * Booking asks for them here rather than reading `clinic.clinics` itself, so
   * the columns stay owned by one library.
   */
  async findPolicy(
    clinicId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicPolicy | null> {
    const result = await db.query<PolicyRow>(
      `select auto_confirm_parent_bookings, min_lead_minutes,
              cancellation_cutoff_minutes, grace_period_minutes,
              max_self_defers
         from clinic.clinics where id = $1 and active`,
      [clinicId],
    );
    const row = result.rows[0];
    return row
      ? {
          autoConfirmParentBookings: row.auto_confirm_parent_bookings,
          minLeadMinutes: row.min_lead_minutes,
          cancellationCutoffMinutes: row.cancellation_cutoff_minutes,
          gracePeriodMinutes: row.grace_period_minutes,
          maxSelfDefers: row.max_self_defers,
        }
      : null;
  }
}

/** Clinic rules the domains apply. Deliberately not part of any API contract. */
export interface ClinicPolicy {
  autoConfirmParentBookings: boolean;
  /** How close to a window the clinic still accepts a booking. */
  minLeadMinutes: number;
  /** How long before a window a parent may still cancel or reschedule. */
  cancellationCutoffMinutes: number;
  gracePeriodMinutes: number;
  maxSelfDefers: number;
}

interface PolicyRow extends QueryResultRow {
  auto_confirm_parent_bookings: boolean;
  min_lead_minutes: number;
  cancellation_cutoff_minutes: number;
  grace_period_minutes: number;
  max_self_defers: number;
}

function toClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    defaultCountryCode: row.default_country_code,
    gracePeriodMinutes: row.grace_period_minutes,
    maxSelfDefers: row.max_self_defers,
    autoConfirmParentBookings: row.auto_confirm_parent_bookings,
    today: row.today,
  };
}

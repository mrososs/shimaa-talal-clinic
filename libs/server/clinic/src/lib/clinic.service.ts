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

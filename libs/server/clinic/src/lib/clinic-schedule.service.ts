import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type {
  ClinicClosure,
  ClinicSchedule,
  ClinicSessionKind,
} from '@clinic/contracts';

interface ScheduleRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  doctor_member_id: string;
  weekday: number;
  session_kind: string;
  starts_at: string;
  ends_at: string;
  window_minutes: number;
  capacity_per_window: number;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
}

interface ClosureRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  doctor_member_id: string | null;
  starts_at: Date;
  ends_at: Date;
  reason: string;
}

/**
 * Dates are cast to text and times trimmed to `HH:MM` in SQL.
 *
 * node-postgres would parse a bare `date` at the *host's* midnight, which is a
 * different calendar day whenever the zones disagree — and a `time` comes back
 * as `10:00:00`, which no screen wants to render.
 */
const SCHEDULE_COLUMNS = `
  id, clinic_id, doctor_member_id, weekday, session_kind,
  to_char(starts_at, 'HH24:MI') as starts_at,
  to_char(ends_at,   'HH24:MI') as ends_at,
  window_minutes, capacity_per_window,
  effective_from::text as effective_from,
  effective_to::text   as effective_to,
  active
`;

const CLOSURE_COLUMNS =
  'id, clinic_id, doctor_member_id, starts_at, ends_at, reason';

/**
 * The template, and the exceptions to it.
 *
 * Read-mostly: availability asks what the clinic runs and what it is closed
 * for, then materialises sessions from the answer. Editing schedules is a
 * settings screen that does not exist yet, which is why only closures can be
 * written here — reception genuinely needs to record "the doctor is out this
 * afternoon" today.
 */
@Injectable()
export class ClinicScheduleService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * The schedules that describe a given clinic-local date.
   *
   * `distinct on` keeps only the newest schedule effective for that date.
   * Schedules are superseded by dating them rather than deleting them, so
   * several rows legitimately match one weekday — only the latest describes how
   * the clinic runs now.
   */
  async findForDate(
    clinicId: string,
    date: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSchedule[]> {
    const result = await db.query<ScheduleRow>(
      `select distinct on (doctor_member_id, session_kind) ${SCHEDULE_COLUMNS}
         from clinic.clinic_schedules
        where clinic_id = $1
          and active
          and weekday = extract(dow from $2::date)
          and effective_from <= $2::date
          and (effective_to is null or effective_to >= $2::date)
        order by doctor_member_id, session_kind, effective_from desc`,
      [clinicId, date],
    );
    return result.rows.map(toSchedule);
  }

  /** Every schedule the clinic holds, for a settings screen and for tests. */
  async listAll(
    clinicId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSchedule[]> {
    const result = await db.query<ScheduleRow>(
      `select ${SCHEDULE_COLUMNS} from clinic.clinic_schedules
        where clinic_id = $1
        order by weekday, session_kind, effective_from desc`,
      [clinicId],
    );
    return result.rows.map(toSchedule);
  }

  /**
   * Closures overlapping a span.
   *
   * Overlap, not containment: a closure from 11:30 to 12:30 affects an 11:00
   * window even though it neither starts nor ends inside it. Getting this
   * predicate wrong is how a clinic ends up booking patients into a lunch break.
   */
  async findOverlapping(
    clinicId: string,
    from: Date | string,
    to: Date | string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicClosure[]> {
    const result = await db.query<ClosureRow>(
      `select ${CLOSURE_COLUMNS} from clinic.clinic_closures
        where clinic_id = $1
          and starts_at < $3
          and ends_at   > $2
        order by starts_at`,
      [clinicId, from, to],
    );
    return result.rows.map(toClosure);
  }

  async createClosure(
    input: {
      clinicId: string;
      doctorMemberId?: string | null;
      startsAt: Date | string;
      endsAt: Date | string;
      reason: string;
      createdByMemberId?: string | null;
    },
    db: SqlExecutor = this.database,
  ): Promise<ClinicClosure> {
    const result = await db.query<ClosureRow>(
      `insert into clinic.clinic_closures
         (clinic_id, doctor_member_id, starts_at, ends_at, reason,
          created_by_member_id)
       values ($1, $2, $3, $4, $5, $6)
       returning ${CLOSURE_COLUMNS}`,
      [
        input.clinicId,
        input.doctorMemberId ?? null,
        input.startsAt,
        input.endsAt,
        input.reason.trim(),
        input.createdByMemberId ?? null,
      ],
    );
    return toClosure(result.rows[0]);
  }
}

function toSchedule(row: ScheduleRow): ClinicSchedule {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    doctorMemberId: row.doctor_member_id,
    weekday: row.weekday,
    sessionKind: row.session_kind as ClinicSessionKind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    windowMinutes: row.window_minutes,
    capacityPerWindow: row.capacity_per_window,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    active: row.active,
  };
}

function toClosure(row: ClosureRow): ClinicClosure {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    doctorMemberId: row.doctor_member_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    reason: row.reason,
  };
}

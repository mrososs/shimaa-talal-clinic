import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import {
  ClinicSessionStatus,
  DoctorPresence,
  type ClinicSession,
  type ClinicSessionKind,
} from '@clinic/contracts';
import { ClinicError, ClinicErrorCode } from './clinic.errors';

interface SessionRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  doctor_member_id: string;
  session_date: string;
  session_kind: string;
  planned_start: Date;
  planned_end: Date;
  window_minutes: number;
  capacity_per_window: number;
  status: string;
  doctor_presence: string;
  delay_minutes: number | null;
  delay_note: string | null;
  avg_consult_minutes: number;
  revision: string;
}

/**
 * `session_date` is cast to text in SQL rather than read as a `Date`.
 *
 * node-postgres parses a bare `date` into a JavaScript Date at the *host's*
 * midnight, which is a different calendar day from the clinic's whenever the
 * two zones disagree. The column already holds the clinic's own day; casting to
 * text is what stops the driver reinterpreting it.
 */
const SESSION_COLUMNS = `
  id, clinic_id, doctor_member_id,
  session_date::text as session_date, session_kind,
  planned_start, planned_end, window_minutes, capacity_per_window,
  status, doctor_presence, delay_minutes, delay_note,
  avg_consult_minutes, revision::text as revision
`;

/**
 * The operational day.
 *
 * Everything here is about a *session*, never about a patient. Doctor presence,
 * the pace estimate, whether the queue is running — these are facts about a
 * half-day, and storing them per queue entry would mean writing the same thing
 * many times and getting it wrong at least once.
 *
 * This service owns the row that Queue takes its lock on. It does not know what
 * a queue entry is, and Queue does not write these columns directly: it calls
 * the six commands below. That asymmetry is what lets Booking and Queue both
 * depend on the day without depending on each other.
 */
@Injectable()
export class ClinicSessionService {
  constructor(private readonly database: DatabaseService) {}

  async findById(
    clinicId: string,
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession | null> {
    const result = await db.query<SessionRow>(
      `select ${SESSION_COLUMNS} from clinic.clinic_sessions
        where id = $1 and clinic_id = $2`,
      [sessionId, clinicId],
    );
    return result.rows[0] ? toSession(result.rows[0]) : null;
  }

  /** Every session already materialised for a clinic-local date. */
  async findByDate(
    clinicId: string,
    date: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession[]> {
    const result = await db.query<SessionRow>(
      `select ${SESSION_COLUMNS} from clinic.clinic_sessions
        where clinic_id = $1 and session_date = $2::date
        order by planned_start`,
      [clinicId, date],
    );
    return result.rows.map(toSession);
  }

  /**
   * Materialise the sessions a date's schedules call for, then return them.
   *
   * Idempotent by the unique index, not by a prior read: two parents opening
   * the booking screen at the same moment both run this, and `on conflict do
   * nothing` is what makes the second one harmless. A check-then-insert would
   * be a race that produces a duplicate day.
   *
   * `distinct on` picks the newest schedule effective for the date. Schedules
   * are superseded by dating them rather than deleting them, so several rows
   * can legitimately match the same weekday — only the latest one describes how
   * the clinic runs now.
   *
   * Wall-clock times become instants here, against the clinic's own timezone.
   * That conversion belongs at materialisation and nowhere else: it is the one
   * moment where "10:00 on Tuesday" becomes a point on the clock.
   */
  async ensureForDate(
    clinicId: string,
    date: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession[]> {
    await db.query(
      `insert into clinic.clinic_sessions (
         clinic_id, doctor_member_id, session_date, session_kind,
         planned_start, planned_end, window_minutes, capacity_per_window,
         avg_consult_minutes)
       select distinct on (s.doctor_member_id, s.session_kind)
         s.clinic_id,
         s.doctor_member_id,
         $2::date,
         s.session_kind,
         (($2::date + s.starts_at) at time zone c.timezone),
         (($2::date + s.ends_at)   at time zone c.timezone),
         s.window_minutes,
         s.capacity_per_window,
         c.default_avg_consult_minutes
       from clinic.clinic_schedules s
       join clinic.clinics c on c.id = s.clinic_id and c.active
       where s.clinic_id = $1
         and s.active
         and s.weekday = extract(dow from $2::date)
         and s.effective_from <= $2::date
         and (s.effective_to is null or s.effective_to >= $2::date)
       order by s.doctor_member_id, s.session_kind, s.effective_from desc
       on conflict (clinic_id, doctor_member_id, session_date, session_kind)
       do nothing`,
      [clinicId, date],
    );

    return this.findByDate(clinicId, date, db);
  }

  /**
   * Take the session's row lock. The concurrency root for the whole queue.
   *
   * Every mutating queue command and every check-in starts here, inside a
   * transaction. That single lock serialises ticket allocation, sort-key
   * placement and the "one patient served at a time" invariant, and it is
   * scoped to one clinic half-day so unrelated clinics never contend.
   *
   * Requires a caller-supplied executor: a lock taken outside a transaction is
   * released immediately and protects nothing, so there is no default here.
   */
  async lockForUpdate(
    clinicId: string,
    sessionId: string,
    tx: SqlExecutor,
  ): Promise<ClinicSession> {
    const result = await tx.query<SessionRow>(
      `select ${SESSION_COLUMNS} from clinic.clinic_sessions
        where id = $1 and clinic_id = $2
        for update`,
      [sessionId, clinicId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw sessionNotFound();
    }
    return toSession(row);
  }

  /**
   * Start the day, or resume after a pause.
   *
   * One command for both because they are the same gesture at the desk, and
   * `opened_at` is only stamped the first time — a pause in the middle of the
   * morning must not rewrite when the morning began.
   */
  async open(
    clinicId: string,
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession> {
    return this.transition(
      clinicId,
      sessionId,
      ClinicSessionStatus.Open,
      `set status = 'open',
           opened_at = coalesce(opened_at, now())`,
      [ClinicSessionStatus.Scheduled, ClinicSessionStatus.Paused],
      db,
    );
  }

  async pause(
    clinicId: string,
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession> {
    return this.transition(
      clinicId,
      sessionId,
      ClinicSessionStatus.Paused,
      `set status = 'paused'`,
      [ClinicSessionStatus.Open],
      db,
    );
  }

  async resume(
    clinicId: string,
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession> {
    return this.transition(
      clinicId,
      sessionId,
      ClinicSessionStatus.Open,
      `set status = 'open'`,
      [ClinicSessionStatus.Paused],
      db,
    );
  }

  /**
   * End the day.
   *
   * Final: a closed session does not reopen. Reopening would resurrect a queue
   * staff deliberately emptied, and the patients in it were told to go home.
   */
  async close(
    clinicId: string,
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession> {
    return this.transition(
      clinicId,
      sessionId,
      ClinicSessionStatus.Closed,
      `set status = 'closed', closed_at = coalesce(closed_at, now())`,
      [
        ClinicSessionStatus.Scheduled,
        ClinicSessionStatus.Open,
        ClinicSessionStatus.Paused,
      ],
      db,
    );
  }

  /**
   * What staff say about the doctor's arrival.
   *
   * This is the honest input to what a parent is shown. The app says the queue
   * has not started because the doctor has not arrived, rather than counting
   * down to a turn that cannot come.
   */
  async setDoctorPresence(
    clinicId: string,
    sessionId: string,
    input: {
      presence: DoctorPresence;
      delayMinutes?: number | null;
      note?: string | null;
    },
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession> {
    const result = await db.query<SessionRow>(
      `update clinic.clinic_sessions
          set doctor_presence = $3,
              -- A presence of "arrived" clears any delay staff had entered:
              -- leaving a stale "20 minutes late" on an arrived doctor is
              -- worse than saying nothing.
              --
              -- The casts are load-bearing. Both CASE branches are otherwise
              -- untyped: an untyped NULL and an untyped parameter. Postgres
              -- then infers text, and refuses to assign text to an integer
              -- column.
              delay_minutes = case
                                when $3 = 'arrived' then null
                                else $4::integer
                              end,
              delay_note    = case
                                when $3 = 'arrived' then null
                                else $5::text
                              end,
              presence_updated_at = now()
        where id = $1 and clinic_id = $2
        returning ${SESSION_COLUMNS}`,
      [
        sessionId,
        clinicId,
        input.presence,
        input.delayMinutes ?? null,
        input.note ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw sessionNotFound();
    return toSession(row);
  }

  /** The pace stepper. Feeds a coarse estimate, never a countdown. */
  async setPace(
    clinicId: string,
    sessionId: string,
    avgConsultMinutes: number,
    db: SqlExecutor = this.database,
  ): Promise<ClinicSession> {
    const result = await db.query<SessionRow>(
      `update clinic.clinic_sessions
          set avg_consult_minutes = $3
        where id = $1 and clinic_id = $2
        returning ${SESSION_COLUMNS}`,
      [sessionId, clinicId, avgConsultMinutes],
    );
    const row = result.rows[0];
    if (row === undefined) throw sessionNotFound();
    return toSession(row);
  }

  /**
   * Mark the board as changed.
   *
   * Called by Queue inside the same transaction as the state change it
   * describes — a revision that lands separately would tell a poller "nothing
   * changed" about a change that had already happened.
   */
  async bumpRevision(
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<number> {
    const result = await db.query<{ revision: string }>(
      `update clinic.clinic_sessions
          set revision = revision + 1
        where id = $1
        returning revision::text as revision`,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw sessionNotFound();
    return Number(row.revision);
  }

  /**
   * Apply a status change, or report why it did not apply.
   *
   * The precondition is in the `WHERE`, not in a prior `SELECT`. Two staff
   * pressing the same button at once both run this; one updates a row and the
   * other updates none, and neither corrupts anything. `rowCount = 0` then
   * means "already in some other state", which is answered with the current
   * state rather than an error — a double-click at reception is not a failure.
   */
  private async transition(
    clinicId: string,
    sessionId: string,
    target: ClinicSessionStatus,
    assignment: string,
    from: readonly ClinicSessionStatus[],
    db: SqlExecutor,
  ): Promise<ClinicSession> {
    const result = await db.query<SessionRow>(
      `update clinic.clinic_sessions
          ${assignment}
        where id = $1 and clinic_id = $2 and status = any($3)
        returning ${SESSION_COLUMNS}`,
      [sessionId, clinicId, from],
    );

    const row = result.rows[0];
    if (row !== undefined) return toSession(row);

    const current = await this.findById(clinicId, sessionId, db);
    if (current === null) throw sessionNotFound();

    // Already where the caller wanted it. Checked before the refusal below, so
    // that closing a closed session stays a no-op while *reopening* one does
    // not.
    if (current.status === target) return current;

    // Closing is the one transition that cannot be undone, so a request to
    // move a closed session anywhere else is a genuine refusal.
    if (current.status === ClinicSessionStatus.Closed) {
      throw new ClinicError(
        ClinicErrorCode.SessionClosed,
        'This session is closed.',
      );
    }

    // A legal state the caller did not ask about — pausing a scheduled session,
    // say. Idempotent by design: reception double-clicking is not a failure.
    return current;
  }
}

function sessionNotFound(): ClinicError {
  return new ClinicError(
    ClinicErrorCode.SessionNotFound,
    'No such session at this clinic.',
  );
}

function toSession(row: SessionRow): ClinicSession {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    doctorMemberId: row.doctor_member_id,
    sessionDate: row.session_date,
    sessionKind: row.session_kind as ClinicSessionKind,
    plannedStart: row.planned_start.toISOString(),
    plannedEnd: row.planned_end.toISOString(),
    windowMinutes: row.window_minutes,
    capacityPerWindow: row.capacity_per_window,
    status: row.status as ClinicSessionStatus,
    doctorPresence: row.doctor_presence as DoctorPresence,
    delayMinutes: row.delay_minutes,
    delayNote: row.delay_note,
    avgConsultMinutes: row.avg_consult_minutes,
    // bigint arrives as a string; the board compares it as a number.
    revision: Number(row.revision),
  };
}

import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import {
  AppointmentStatus,
  type Appointment,
  type AppointmentCancelledBy,
  type VisitType,
} from '@clinic/contracts';
import {
  BookingError,
  BookingErrorCode,
  isUniqueViolation,
} from './booking.errors';

interface AppointmentRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  session_id: string;
  child_id: string;
  guardian_id: string;
  window_start: Date;
  window_end: Date;
  visit_type: string;
  status: string;
  notes: string | null;
  created_by_member_id: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  rescheduled_from_appointment_id: string | null;
  created_at: Date;
  attendance_intent: string;
  attendance_intent_set_at: Date | null;
}

const COLUMNS = `
  id, clinic_id, session_id, child_id, guardian_id,
  window_start, window_end, visit_type, status, notes,
  created_by_member_id, cancelled_at, cancelled_by, cancellation_reason,
  rescheduled_from_appointment_id, created_at,
  attendance_intent, attendance_intent_set_at
`;

/** Statuses that hold a seat. Anything else has released it. */
const LIVE_STATUSES = [
  AppointmentStatus.Requested,
  AppointmentStatus.Confirmed,
  AppointmentStatus.CheckedIn,
] as const;

/**
 * The legal moves, in one place.
 *
 * Every transition in the system goes through this table. A `switch` in a
 * controller would let each endpoint invent its own idea of what is allowed,
 * and the illegal combinations are exactly the ones nobody writes a test for.
 *
 * `rescheduled` is not here because it is not a state: rescheduling mutates the
 * appointment and appends an event. A terminal `rescheduled` would leave the
 * row inert and force a second row for one visit.
 */
const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  [AppointmentStatus.Requested]: [
    AppointmentStatus.Confirmed,
    AppointmentStatus.Cancelled,
  ],
  [AppointmentStatus.Confirmed]: [
    AppointmentStatus.CheckedIn,
    AppointmentStatus.Cancelled,
    AppointmentStatus.NoShow,
  ],
  // Cancelling after check-in has to cascade into the queue, which is why it
  // is a workflow rather than a call to this service.
  [AppointmentStatus.CheckedIn]: [
    AppointmentStatus.Completed,
    AppointmentStatus.Cancelled,
    AppointmentStatus.NoShow,
  ],
  [AppointmentStatus.Completed]: [],
  [AppointmentStatus.Cancelled]: [],
  [AppointmentStatus.NoShow]: [],
};

/**
 * Slack above the window's capacity when chasing a free seat.
 *
 * The bound is `capacity + this`, and the reason it is capacity-relative rather
 * than a flat number is the whole guarantee. Each collision means somebody else
 * committed the seat we had just read as free — so a collision permanently
 * consumes one of a finite number of seats. After `capacity` of them the window
 * is genuinely full and the next read says so.
 *
 * A flat cap of three looks equivalent and is not: under real contention a
 * caller can lose three races while seats remain, and then report a full window
 * that has space in it. Ten parallel bookings against five seats filled four of
 * them before this was capacity-relative.
 */
export const SEAT_RETRY_SLACK = 2;

export interface CreateAppointmentInput {
  clinicId: string;
  sessionId: string;
  /** The window's start, exactly as availability reported it. */
  windowStart: string;
  childId: string;
  guardianId: string;
  visitType: VisitType;
  notes?: string | null;
  /** Null or absent means the parent booked it themselves. */
  createdByMemberId?: string | null;
}

export interface TransitionActor {
  memberId?: string | null;
  authUserId?: string | null;
  reason?: string | null;
}

/**
 * The appointment aggregate.
 *
 * Owns creation, the lifecycle, and the seat allocation that makes capacity
 * real. Owns nothing about the queue: this service cannot tell you who is
 * waiting, and `checked_in` here means only that a queue entry exists somewhere
 * else.
 */
@Injectable()
export class AppointmentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly clinics: ClinicService,
  ) {}

  async findById(
    clinicId: string,
    appointmentId: string,
    db: SqlExecutor = this.database,
  ): Promise<Appointment | null> {
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where id = $1 and clinic_id = $2`,
      [appointmentId, clinicId],
    );
    return result.rows[0] ? toAppointment(result.rows[0]) : null;
  }

  /**
   * Book a window.
   *
   * Availability is advisory; this is where capacity is actually decided. The
   * lowest free seat is read and then claimed, and if another booking claimed
   * it in between, the unique index says so and this tries the next one. The
   * loop is bounded by the window's own capacity, which is what makes "a
   * window with space always fills" true rather than likely — see
   * `SEAT_RETRY_SLACK`.
   *
   * A second booking for the same child in the same session is not an error:
   * it is a double-tap on "confirm", and the existing appointment is returned.
   */
  async create(
    input: CreateAppointmentInput,
    db?: SqlExecutor,
  ): Promise<Appointment> {
    if (db === undefined) {
      return this.database.transaction((tx) => this.create(input, tx));
    }
    const window = await this.requireBookableWindow(
      input.clinicId,
      input.sessionId,
      input.windowStart,
      db,
    );

    const status = await this.initialStatus(input, db);

    const maxAttempts = window.capacity + SEAT_RETRY_SLACK;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const seat = await this.lowestFreeSeat(
        input.sessionId,
        input.windowStart,
        window.capacity,
        db,
      );
      if (seat === null) {
        throw slotUnavailable();
      }

      try {
        await db.query('savepoint appointment_seat_attempt');
        const result = await db.query<AppointmentRow>(
          `insert into clinic.appointments
             (clinic_id, session_id, child_id, guardian_id,
              window_start, window_end, seat_no, visit_type, status, notes,
              created_by_member_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           returning ${COLUMNS}`,
          [
            input.clinicId,
            input.sessionId,
            input.childId,
            input.guardianId,
            input.windowStart,
            window.windowEnd,
            seat,
            input.visitType,
            status,
            input.notes ?? null,
            input.createdByMemberId ?? null,
          ],
        );

        const created = toAppointment(result.rows[0]);
        await this.recordEvent(
          created.id,
          'created',
          null,
          created.status,
          {
            memberId: input.createdByMemberId ?? null,
          },
          db,
        );
        await this.bumpBookingRevision(created.sessionId, db);
        await db.query('release savepoint appointment_seat_attempt');
        return created;
      } catch (error) {
        await db.query('rollback to savepoint appointment_seat_attempt');
        await db.query('release savepoint appointment_seat_attempt');
        if (isUniqueViolation(error, 'appointments_child_session_uq')) {
          // The same child, already booked into this session. A double-tap,
          // not a failure — hand back what already exists.
          const existing = await this.findLiveForChild(
            input.sessionId,
            input.childId,
            db,
          );
          if (existing !== null) return existing;
        }

        if (!isUniqueViolation(error, 'appointments_seat_uq')) {
          throw error;
        }
        // Someone took the seat between the read and the insert. Try the next.
      }
    }

    throw slotUnavailable();
  }

  /**
   * Move an appointment, or refuse.
   *
   * The precondition is in the `WHERE`, so two callers racing the same
   * transition cannot both succeed. `rowCount = 0` then means the row moved
   * underneath us, and the current state decides whether that is benign.
   */
  async transition(
    clinicId: string,
    appointmentId: string,
    to: AppointmentStatus,
    actor: TransitionActor = {},
    db?: SqlExecutor,
  ): Promise<Appointment> {
    if (db === undefined) {
      return this.database.transaction((tx) =>
        this.transition(clinicId, appointmentId, to, actor, tx),
      );
    }
    const current = await this.findById(clinicId, appointmentId, db);
    if (current === null) throw appointmentNotFound();

    if (current.status === to) {
      // Already there. Idempotent by design: a double-clicked approve button is
      // not an error, and reporting one would make the screen lie.
      return current;
    }

    if (!TRANSITIONS[current.status].includes(to)) {
      throw new BookingError(
        BookingErrorCode.InvalidTransition,
        `An appointment that is ${current.status} cannot become ${to}.`,
      );
    }

    const cancelling = to === AppointmentStatus.Cancelled;
    const result = await db.query<AppointmentRow>(
      `update clinic.appointments
          set status = $3,
              cancelled_at = case when $3 = 'cancelled' then now() else cancelled_at end,
              cancelled_by = case when $3 = 'cancelled' then $4::text else cancelled_by end,
              cancellation_reason =
                case when $3 = 'cancelled' then $5::text else cancellation_reason end
        where id = $1 and clinic_id = $2 and status = $6
        returning ${COLUMNS}`,
      [
        appointmentId,
        clinicId,
        to,
        cancelling ? cancelledBy(actor) : null,
        cancelling ? (actor.reason ?? null) : null,
        current.status,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) {
      // Something else moved it first. Re-read and answer from the truth.
      const now = await this.findById(clinicId, appointmentId, db);
      if (now === null) throw appointmentNotFound();
      if (now.status === to) return now;
      throw new BookingError(
        BookingErrorCode.InvalidTransition,
        `An appointment that is ${now.status} cannot become ${to}.`,
      );
    }

    const updated = toAppointment(row);
    await this.recordEvent(updated.id, to, current.status, to, actor, db);
    await this.bumpBookingRevision(updated.sessionId, db);
    return updated;
  }

  /**
   * A parent calling their own visit off.
   *
   * Separate from `transition` because it carries a rule staff do not have:
   * the clinic's cutoff. Staff can cancel at any time — somebody has to be able
   * to, when a parent phones five minutes before.
   */
  async cancelAsParent(
    clinicId: string,
    appointmentId: string,
    actor: TransitionActor,
    db?: SqlExecutor,
  ): Promise<Appointment> {
    if (db === undefined) {
      return this.database.transaction((tx) =>
        this.cancelAsParent(clinicId, appointmentId, actor, tx),
      );
    }
    const appointment = await this.findById(clinicId, appointmentId, db);
    if (appointment === null) throw appointmentNotFound();

    const policy = await this.clinics.findPolicy(clinicId, db);
    const cutoffMinutes = policy?.cancellationCutoffMinutes ?? 0;
    const deadline =
      new Date(appointment.windowStart).getTime() - cutoffMinutes * 60_000;

    if (Date.now() > deadline) {
      throw new BookingError(
        BookingErrorCode.CancellationTooLate,
        'It is too late to cancel this appointment online.',
        undefined,
        { cutoffMinutes },
      );
    }

    return this.transition(
      clinicId,
      appointmentId,
      AppointmentStatus.Cancelled,
      { ...actor, memberId: null },
      db,
    );
  }

  /**
   * Move an appointment to another window.
   *
   * Cancel-and-rebook in one transaction, not an UPDATE of the window: the old
   * seat has to be released and a new one claimed, and both are decided by the
   * same unique index. Doing it as two calls would leave a moment where the
   * family holds two seats or none.
   *
   * The new appointment points back at the old one, which is the whole audit
   * trail — and the reason there is no `rescheduled` status.
   */
  async reschedule(
    clinicId: string,
    appointmentId: string,
    target: { sessionId: string; windowStart: string },
    actor: TransitionActor,
    db?: SqlExecutor,
  ): Promise<Appointment> {
    const run = async (tx: SqlExecutor): Promise<Appointment> => {
      const original = await this.findByIdForUpdate(
        clinicId,
        appointmentId,
        tx,
      );
      if (original === null) throw appointmentNotFound();

      // A retry after the first transaction committed returns the one live
      // replacement rather than booking a second seat.
      const existing = await this.findLiveRescheduledFrom(
        clinicId,
        appointmentId,
        tx,
      );
      if (existing !== null) return existing;

      if (
        original.status !== AppointmentStatus.Requested &&
        original.status !== AppointmentStatus.Confirmed &&
        original.status !== AppointmentStatus.NoShow
      ) {
        throw new BookingError(
          BookingErrorCode.InvalidTransition,
          `An appointment that is ${original.status} cannot be rescheduled.`,
        );
      }

      // A live booking releases its old seat first, so the family can move even
      // within the same full window. A no-show has already released its seat
      // and remains no-show in history; the orchestration workflow is the only
      // caller allowed to reopen it, after proving a paid credit exists.
      if (original.status !== AppointmentStatus.NoShow) {
        await this.transition(
          clinicId,
          appointmentId,
          AppointmentStatus.Cancelled,
          { ...actor, reason: actor.reason ?? 'rescheduled' },
          tx,
        );
      }

      const replacement = await this.create(
        {
          clinicId,
          sessionId: target.sessionId,
          windowStart: target.windowStart,
          childId: original.childId,
          guardianId: original.guardianId,
          visitType: original.visitType,
          notes: original.notes,
          createdByMemberId: actor.memberId ?? null,
        },
        tx,
      );

      await tx.query(
        `update clinic.appointments
            set rescheduled_from_appointment_id = $2
          where id = $1`,
        [replacement.id, appointmentId],
      );

      await this.recordEvent(
        replacement.id,
        'rescheduled',
        original.status,
        replacement.status,
        actor,
        tx,
      );

      return { ...replacement, rescheduledFromAppointmentId: appointmentId };
    };

    // One transaction, or the family briefly holds two seats or none.
    return db === undefined ? this.database.transaction(run) : run(db);
  }

  /** Lock one appointment before a cross-domain reschedule decision. */
  async findByIdForUpdate(
    clinicId: string,
    appointmentId: string,
    db: SqlExecutor,
  ): Promise<Appointment | null> {
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where id = $1 and clinic_id = $2
        for update`,
      [appointmentId, clinicId],
    );
    return result.rows[0] ? toAppointment(result.rows[0]) : null;
  }

  /** The live replacement makes an already-completed reschedule idempotent. */
  async findLiveRescheduledFrom(
    clinicId: string,
    appointmentId: string,
    db: SqlExecutor,
  ): Promise<Appointment | null> {
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where clinic_id = $1 and rescheduled_from_appointment_id = $2
          and status = any($3)
        order by created_at desc limit 1`,
      [clinicId, appointmentId, LIVE_STATUSES],
    );
    return result.rows[0] ? toAppointment(result.rows[0]) : null;
  }

  /** A missed patient returned to today's queue; restore the linked booking. */
  async restoreNoShowCheckIn(
    clinicId: string,
    appointmentId: string,
    actor: TransitionActor,
    db: SqlExecutor,
  ): Promise<Appointment> {
    const current = await this.findByIdForUpdate(clinicId, appointmentId, db);
    if (current === null) throw appointmentNotFound();
    if (current.status === AppointmentStatus.CheckedIn) return current;
    if (current.status !== AppointmentStatus.NoShow) {
      throw new BookingError(
        BookingErrorCode.InvalidTransition,
        `Only a no-show appointment can return to check-in; this one is ${current.status}.`,
      );
    }
    const updated = await db.query<AppointmentRow>(
      `update clinic.appointments set status='checked_in'
        where id=$1 and clinic_id=$2 and status='no_show'
        returning ${COLUMNS}`,
      [appointmentId, clinicId],
    );
    const row = updated.rows[0];
    if (!row) throw appointmentNotFound();
    const appointment = toAppointment(row);
    await this.recordEvent(
      appointment.id,
      'requeued',
      AppointmentStatus.NoShow,
      AppointmentStatus.CheckedIn,
      actor,
      db,
    );
    return appointment;
  }

  /** Today's appointments for a clinic, for the staff day view. */
  async listForDay(
    clinicId: string,
    date: string,
    db: SqlExecutor = this.database,
  ): Promise<Appointment[]> {
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments a
        where a.clinic_id = $1
          and a.session_id in (
            select id from clinic.clinic_sessions
             where clinic_id = $1 and session_date = $2::date)
        order by a.window_start, a.created_at`,
      [clinicId, date],
    );
    return result.rows.map(toAppointment);
  }

  /** A bounded staff calendar range, ordered exactly as the calendar renders. */
  async listForRange(
    clinicId: string,
    from: string,
    to: string,
    db: SqlExecutor = this.database,
  ): Promise<Appointment[]> {
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments a
        where a.clinic_id = $1
          and a.session_id in (
            select id from clinic.clinic_sessions
             where clinic_id = $1
               and session_date between $2::date and $3::date)
        order by a.window_start, a.created_at`,
      [clinicId, from, to],
    );
    return result.rows.map(toAppointment);
  }

  /**
   * Every appointment booked into one session.
   *
   * The queue board needs this to show who is still expected — the families
   * with a confirmed visit and no queue entry yet. Scoped to the session rather
   * than the day because a board is one half-day: the evening clinic's arrivals
   * are not the morning's problem.
   */
  async listForSession(
    clinicId: string,
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<Appointment[]> {
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where clinic_id = $1 and session_id = $2
        order by window_start, seat_no`,
      [clinicId, sessionId],
    );
    return result.rows.map(toAppointment);
  }

  /**
   * One family's appointments inside a given set of sessions.
   *
   * The live-queue screen needs today's visit and only today's: a booking three
   * weeks out is not what a parent standing in the clinic is asking about.
   * Sessions are passed in because this library does not know what "today"
   * means for a clinic — that lives with the clinic's timezone.
   */
  async listForGuardianInSessions(
    clinicId: string,
    guardianId: string,
    sessionIds: readonly string[],
    db: SqlExecutor = this.database,
  ): Promise<Appointment[]> {
    if (sessionIds.length === 0) return [];

    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where clinic_id = $1
          and guardian_id = $2
          and session_id = any($3)
        order by window_start`,
      [clinicId, guardianId, [...sessionIds]],
    );
    return result.rows.map(toAppointment);
  }

  /**
   * A guardian's own appointments.
   *
   * Scoped by `guardian_id` in the query rather than filtered afterwards. A
   * check that happens after the read is a check somebody eventually forgets.
   */
  async listForGuardian(
    clinicId: string,
    guardianId: string,
    scope: 'upcoming' | 'past',
    db: SqlExecutor = this.database,
  ): Promise<Appointment[]> {
    const upcoming = scope === 'upcoming';
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where clinic_id = $1
          and guardian_id = $2
          and (
            case when $3 then window_end >= now() and status in
                   ('requested', 'confirmed', 'checked_in')
                 else window_end < now() or status in
                   ('completed', 'cancelled', 'no_show')
            end
          )
        order by window_start ${upcoming ? 'asc' : 'desc'}
        limit 100`,
      [clinicId, guardianId, upcoming],
    );
    return result.rows.map(toAppointment);
  }

  /**
   * The appointment a check-in is about, locked against concurrent movement.
   *
   * Used only by the check-in workflow, and only inside its transaction — hence
   * the required executor. It refuses anything that is not a confirmed
   * appointment for today, so the workflow never has to re-derive eligibility.
   */
  async findForCheckIn(
    clinicId: string,
    appointmentId: string,
    tx: SqlExecutor,
  ): Promise<Appointment> {
    const result = await tx.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where id = $1 and clinic_id = $2
        for update`,
      [appointmentId, clinicId],
    );
    const row = result.rows[0];
    if (row === undefined) throw appointmentNotFound();

    const appointment = toAppointment(row);
    if (appointment.status !== AppointmentStatus.Confirmed) {
      throw new BookingError(
        BookingErrorCode.InvalidTransition,
        `Only a confirmed appointment can be checked in; this one is ${appointment.status}.`,
      );
    }
    return appointment;
  }

  /**
   * Whether a window can still be booked, and how big it is.
   *
   * Reads the session rather than trusting the caller's window: a client could
   * otherwise post any instant it liked and book outside the clinic's hours.
   */
  private async requireBookableWindow(
    clinicId: string,
    sessionId: string,
    windowStart: string,
    db: SqlExecutor,
  ): Promise<{ windowEnd: string; capacity: number }> {
    const result = await db.query<{
      window_end: Date;
      capacity: number;
      too_late: boolean;
    }>(
      `select
         least($3::timestamptz + make_interval(mins => s.window_minutes),
               s.planned_end)                                as window_end,
         s.capacity_per_window                               as capacity,
         ($3::timestamptz < now() + make_interval(mins => c.min_lead_minutes))
                                                             as too_late
       from clinic.clinic_sessions s
       join clinic.clinics c on c.id = s.clinic_id
       where s.id = $1
         and s.clinic_id = $2
         and s.status <> 'closed'
         -- The instant must be a real window boundary in this session, not any
         -- timestamp a client felt like sending.
         and $3::timestamptz >= s.planned_start
         and $3::timestamptz <  s.planned_end
         and mod(
               extract(epoch from ($3::timestamptz - s.planned_start))::bigint,
               s.window_minutes * 60
             ) = 0
         and not exists (
           select 1
             from clinic.clinic_closures closure
            where closure.clinic_id = s.clinic_id
              and (closure.doctor_member_id is null
                   or closure.doctor_member_id = s.doctor_member_id)
              and closure.starts_at < least(
                    $3::timestamptz + make_interval(mins => s.window_minutes),
                    s.planned_end
                  )
              and closure.ends_at > $3::timestamptz
         )`,
      [sessionId, clinicId, windowStart],
    );

    const row = result.rows[0];
    if (row === undefined) {
      throw new BookingError(
        BookingErrorCode.SessionUnavailable,
        'That arrival window is not available.',
      );
    }
    if (row.too_late) {
      throw new BookingError(
        BookingErrorCode.WindowInPast,
        'That arrival window has already started.',
      );
    }
    return {
      windowEnd: row.window_end.toISOString(),
      capacity: row.capacity,
    };
  }

  /** The lowest seat nobody holds, or null when the window is full. */
  private async lowestFreeSeat(
    sessionId: string,
    windowStart: string,
    capacity: number,
    db: SqlExecutor,
  ): Promise<number | null> {
    const result = await db.query<{ seat_no: number }>(
      `select seat.n as seat_no
         from generate_series(1, $3) as seat(n)
        where not exists (
          select 1 from clinic.appointments a
           where a.session_id = $1
             and a.window_start = $2::timestamptz
             and a.seat_no = seat.n
             and a.status = any($4)
        )
        order by seat.n
        limit 1`,
      [sessionId, windowStart, capacity, LIVE_STATUSES],
    );
    return result.rows[0]?.seat_no ?? null;
  }

  private async findLiveForChild(
    sessionId: string,
    childId: string,
    db: SqlExecutor,
  ): Promise<Appointment | null> {
    const result = await db.query<AppointmentRow>(
      `select ${COLUMNS} from clinic.appointments
        where session_id = $1 and child_id = $2 and status = any($3)
        limit 1`,
      [sessionId, childId, LIVE_STATUSES],
    );
    return result.rows[0] ? toAppointment(result.rows[0]) : null;
  }

  /**
   * `requested` or `confirmed`, decided by who is booking and clinic policy.
   *
   * Staff bookings skip approval because the person approving is the person
   * booking. A parent's booking is a request unless the clinic has said
   * otherwise — a column, so the answer can change without a release.
   */
  private async initialStatus(
    input: CreateAppointmentInput,
    db: SqlExecutor,
  ): Promise<AppointmentStatus> {
    if (input.createdByMemberId) return AppointmentStatus.Confirmed;

    const policy = await this.clinics.findPolicy(input.clinicId, db);
    return policy?.autoConfirmParentBookings === true
      ? AppointmentStatus.Confirmed
      : AppointmentStatus.Requested;
  }

  /**
   * Append to the trail, in the same transaction as the change it describes.
   *
   * An event written afterwards is an event that can be missing.
   */
  private async recordEvent(
    appointmentId: string,
    eventType: string,
    fromStatus: string | null,
    toStatus: string | null,
    actor: TransitionActor,
    db: SqlExecutor,
  ): Promise<void> {
    await db.query(
      `insert into clinic.appointment_events
         (appointment_id, event_type, from_status, to_status,
          performed_by_member_id, performed_by_auth_user_id, reason)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        appointmentId,
        eventType,
        fromStatus,
        toStatus,
        actor.memberId ?? null,
        actor.authUserId ?? null,
        actor.reason ?? null,
      ],
    );
  }

  private async bumpBookingRevision(
    sessionId: string,
    db: SqlExecutor,
  ): Promise<void> {
    await db.query(
      `update clinic.clinic_sessions
          set booking_revision = booking_revision + 1
        where id = $1`,
      [sessionId],
    );
  }
}

function cancelledBy(actor: TransitionActor): AppointmentCancelledBy {
  return actor.memberId ? 'clinic' : 'parent';
}

function slotUnavailable(): BookingError {
  return new BookingError(
    BookingErrorCode.SlotUnavailable,
    'That arrival window has just filled up.',
  );
}

function appointmentNotFound(): BookingError {
  return new BookingError(
    BookingErrorCode.AppointmentNotFound,
    'No such appointment at this clinic.',
  );
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    childId: row.child_id,
    guardianId: row.guardian_id,
    windowStart: row.window_start.toISOString(),
    windowEnd: row.window_end.toISOString(),
    visitType: row.visit_type as VisitType,
    status: row.status as AppointmentStatus,
    notes: row.notes,
    createdByMemberId: row.created_by_member_id,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledBy: row.cancelled_by as AppointmentCancelledBy | null,
    cancellationReason: row.cancellation_reason,
    rescheduledFromAppointmentId: row.rescheduled_from_appointment_id,
    createdAt: row.created_at.toISOString(),
    attendanceIntent: row.attendance_intent as Appointment['attendanceIntent'],
    attendanceIntentSetAt:
      row.attendance_intent_set_at?.toISOString() ?? null,
  };
}

import { Injectable } from '@nestjs/common';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { ClinicService, ClinicSessionService } from '@clinic/server-clinic';
import {
  ClinicSessionStatus,
  QueueStatus,
  type QueueEntry,
} from '@clinic/contracts';
import {
  EMERGENCY_PRIORITY,
  NORMAL_PRIORITY,
  QueueEntryService,
} from './queue-entry.service';
import { QueueError, QueueErrorCode, isUniqueViolation } from './queue.errors';

export interface QueueActor {
  memberId?: string | null;
  authUserId?: string | null;
  reason?: string | null;
}

/**
 * Everything that moves a patient through the queue.
 *
 * Three rules hold for every command here, and together they are why the queue
 * cannot be corrupted by two people using it at once:
 *
 *   1. **The session row is locked first.** It is the concurrency root — one
 *      lock per clinic half-day, so unrelated clinics never contend.
 *   2. **The precondition is in the WHERE clause**, not in a prior SELECT. Two
 *      callers racing the same transition both run the UPDATE; one changes a
 *      row and the other changes none.
 *   3. **`rowCount = 0` is answered with the current state**, not an error,
 *      whenever the caller's intent has already been achieved. A receptionist
 *      double-clicking is not a failure, and a stale dashboard should heal
 *      rather than complain.
 *
 * Every command writes exactly one `queue_events` row and bumps the session's
 * revision, both inside the same transaction as the change.
 */
@Injectable()
export class QueueCommandService {
  constructor(
    private readonly database: DatabaseService,
    private readonly entries: QueueEntryService,
    private readonly sessions: ClinicSessionService,
    private readonly clinics: ClinicService,
  ) {}

  /**
   * Check a patient in, or register a walk-in. Both produce an ordinary entry.
   *
   * Refused unless the session is open: a queue that is closed or paused is not
   * accepting people, and letting one in would put a patient in a line that is
   * not moving.
   */
  async admit(
    input: {
      clinicId: string;
      sessionId: string;
      childId: string;
      guardianId?: string | null;
      appointmentId?: string | null;
      visitReason?: string | null;
    },
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const session = await this.requireRunningSession(
        input.clinicId,
        input.sessionId,
        tx,
      );

      const before = input.appointmentId
        ? await this.entries.findByAppointment(
            input.clinicId,
            input.appointmentId,
            tx,
          )
        : null;

      const entry = await this.entries.create(
        { ...input, createdByMemberId: actor.memberId ?? null },
        tx,
      );

      // A second check-in of the same appointment returns the existing entry.
      // Recording another event for it would inflate the trail with a
      // double-click.
      if (before === null) {
        await this.record(entry, 'checked_in', null, entry.status, actor, tx);
        await this.sessions.bumpRevision(session.id, tx);
      }
      return entry;
    });
  }

  /**
   * "Next please."
   *
   * One gesture, so one transaction: whoever is in service is completed, and
   * the next patient is called. Splitting it would leave a window where nobody
   * is being served and a second receptionist could call somebody else.
   */
  async callNext(
    clinicId: string,
    sessionId: string,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      await this.requireRunningSession(clinicId, sessionId, tx);

      // Anyone still called has not come. Calling the next name over them is
      // exactly what "missed" means.
      await tx.query(
        `update clinic.queue_entries
            set status = 'missed'
          where session_id = $1 and status = 'called'`,
        [sessionId],
      );
      await tx.query(
        `update clinic.queue_entries
            set status = 'done', completed_at = now()
          where session_id = $1 and status = 'in_service'`,
        [sessionId],
      );

      const next = await this.entries.nextWaiting(sessionId, tx);
      if (next === null) {
        throw new QueueError(
          QueueErrorCode.QueueEmpty,
          'There is nobody waiting.',
        );
      }

      return this.callEntry(clinicId, next.id, actor, tx);
    });
  }

  /** Call one specific patient, out of order if staff say so. */
  async call(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const entry = await this.requireEntry(clinicId, entryId, tx);
      await this.requireRunningSession(clinicId, entry.sessionId, tx);
      return this.callEntry(clinicId, entryId, actor, tx);
    });
  }

  /** The patient came through: `called → in_service`. */
  async start(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.transition(clinicId, entryId, actor, db, {
      to: QueueStatus.InService,
      from: [QueueStatus.Called],
      assignment: `set status = 'in_service', started_at = now(),
                       grace_expires_at = null`,
      event: 'started',
    });
  }

  /**
   * The visit is over.
   *
   * Completing a queue entry whose appointment must also be completed is a
   * workflow, not this method — Queue does not know appointments exist.
   */
  async complete(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.transition(clinicId, entryId, actor, db, {
      to: QueueStatus.Done,
      from: [QueueStatus.InService, QueueStatus.Called],
      assignment: `set status = 'done', completed_at = now()`,
      event: 'completed',
    });
  }

  /**
   * Called, did not come.
   *
   * Refused before the grace deadline unless staff override with a reason. The
   * deadline is the promise the clinic made when it called the patient, and
   * skipping somebody early without saying why is the thing an audit trail
   * exists to catch.
   */
  async miss(
    clinicId: string,
    entryId: string,
    actor: QueueActor & { force?: boolean },
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const entry = await this.requireEntry(clinicId, entryId, tx);
      await this.sessions.lockForUpdate(clinicId, entry.sessionId, tx);

      const lapsed =
        entry.graceExpiresAt !== null &&
        Date.parse(entry.graceExpiresAt) <= Date.now();

      if (!lapsed && actor.force !== true) {
        throw new QueueError(
          QueueErrorCode.GraceNotExpired,
          'This patient still has time to arrive.',
          undefined,
          { graceExpiresAt: entry.graceExpiresAt },
        );
      }
      if (!lapsed && (actor.reason ?? '').trim() === '') {
        throw new QueueError(
          QueueErrorCode.ReasonRequired,
          'Skipping a patient early needs a reason.',
        );
      }

      return this.applyTransition(
        clinicId,
        entryId,
        {
          to: QueueStatus.Missed,
          from: [QueueStatus.Called, QueueStatus.Waiting],
          assignment: `set status = 'missed', grace_expires_at = null`,
          event: 'missed',
        },
        actor,
        tx,
      );
    });
  }

  /**
   * Put a missed patient back, with a new number, at the end.
   *
   * A new ticket rather than the old one because the design says so and because
   * it is honest: they lost their place, and a number that no longer reflects
   * their position would be a small lie repeated on every screen.
   */
  async requeue(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const entry = await this.requireEntry(clinicId, entryId, tx);
      const session = await this.requireRunningSession(
        clinicId,
        entry.sessionId,
        tx,
      );

      if (entry.status !== QueueStatus.Missed) {
        throw new QueueError(
          QueueErrorCode.InvalidTransition,
          `Only a missed patient can be requeued; this one is ${entry.status}.`,
        );
      }

      const ticket = await tx.query<{ next_ticket_number: number }>(
        `update clinic.clinic_sessions
            set next_ticket_number = next_ticket_number + 1
          where id = $1
          returning next_ticket_number - 1 as next_ticket_number`,
        [entry.sessionId],
      );
      const sortKey = await this.entries.tailSortKey(entry.sessionId, tx);

      await tx.query(
        `update clinic.queue_entries
            set status = 'waiting',
                ticket_number = $2,
                sort_key = $3,
                called_at = null,
                grace_expires_at = null
          where id = $1`,
        [entryId, ticket.rows[0].next_ticket_number, sortKey],
      );

      const updated = await this.requireEntry(clinicId, entryId, tx);
      await this.record(
        updated,
        'requeued',
        QueueStatus.Missed,
        QueueStatus.Waiting,
        actor,
        tx,
      );
      await this.sessions.bumpRevision(session.id, tx);
      return updated;
    });
  }

  /** Remove somebody from the queue. Cancelled, never deleted. */
  async cancel(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.transition(clinicId, entryId, actor, db, {
      to: QueueStatus.Cancelled,
      from: [QueueStatus.Waiting, QueueStatus.Called, QueueStatus.Missed],
      assignment: `set status = 'cancelled', grace_expires_at = null`,
      event: 'cancelled',
    });
  }

  /**
   * Mark or clear an emergency.
   *
   * A single-row update, because ordering is `(priority, sort_key)`: the
   * patient moves to the head of the *waiting* segment and nobody else's key
   * changes. It never preempts the patient in service or the one already
   * called — those two have been told it is their turn.
   */
  async setEmergency(
    clinicId: string,
    entryId: string,
    emergency: boolean,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const entry = await this.requireEntry(clinicId, entryId, tx);
      const session = await this.sessions.lockForUpdate(
        clinicId,
        entry.sessionId,
        tx,
      );

      const reason = (actor.reason ?? '').trim();
      if (emergency && reason === '') {
        throw new QueueError(
          QueueErrorCode.ReasonRequired,
          'An emergency needs a reason.',
        );
      }

      await tx.query(
        `update clinic.queue_entries
            set priority = $2,
                emergency_reason = $3,
                emergency_marked_by = $4,
                emergency_marked_at = case when $5 then now() else null end
          where id = $1`,
        [
          entryId,
          emergency ? EMERGENCY_PRIORITY : NORMAL_PRIORITY,
          emergency ? reason : null,
          emergency ? (actor.memberId ?? null) : null,
          emergency,
        ],
      );

      const updated = await this.requireEntry(clinicId, entryId, tx);
      await this.record(
        updated,
        emergency ? 'emergency_set' : 'emergency_cleared',
        entry.status,
        updated.status,
        actor,
        tx,
      );
      await this.sessions.bumpRevision(session.id, tx);
      return updated;
    });
  }

  /**
   * Move a patient between two neighbours.
   *
   * One row changes. A dense position column would rewrite everything below the
   * insertion and deadlock against concurrent check-ins.
   */
  async move(
    clinicId: string,
    entryId: string,
    target: { beforeEntryId?: string | null; afterEntryId?: string | null },
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const entry = await this.requireEntry(clinicId, entryId, tx);
      const session = await this.sessions.lockForUpdate(
        clinicId,
        entry.sessionId,
        tx,
      );

      const sortKey = await this.entries.midpointSortKey(
        entry.sessionId,
        target.beforeEntryId ?? null,
        target.afterEntryId ?? null,
        tx,
      );

      await tx.query(
        `update clinic.queue_entries set sort_key = $2 where id = $1`,
        [entryId, sortKey],
      );

      const updated = await this.requireEntry(clinicId, entryId, tx);
      await this.record(updated, 'moved', entry.status, updated.status, actor, tx);
      await this.sessions.bumpRevision(session.id, tx);
      return updated;
    });
  }

  /**
   * A parent giving up their own turn, once.
   *
   * The only write a parent makes into the queue, and it is capped by clinic
   * policy. Only possible while still waiting: once called, the turn is
   * happening.
   */
  async defer(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    db?: SqlExecutor,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const entry = await this.requireEntry(clinicId, entryId, tx);
      const session = await this.sessions.lockForUpdate(
        clinicId,
        entry.sessionId,
        tx,
      );

      if (entry.status !== QueueStatus.Waiting) {
        throw new QueueError(
          QueueErrorCode.InvalidTransition,
          'Only a waiting patient can defer their turn.',
        );
      }

      const policy = await this.clinics.findPolicy(clinicId, tx);
      const limit = policy?.maxSelfDefers ?? 0;
      if (entry.deferCount >= limit) {
        throw new QueueError(
          QueueErrorCode.DeferLimitReached,
          'You have used all your deferrals for today.',
          undefined,
          { maxSelfDefers: limit },
        );
      }

      // One place back, not to the end: deferring is "let the next person go",
      // not "start again".
      const nextTwo = await tx.query<{ id: string; sort_key: string }>(
        `select id, sort_key::text as sort_key from clinic.queue_entries
          where session_id = $1
            and status = 'waiting'
            and (priority, sort_key) > (
              select priority, sort_key from clinic.queue_entries where id = $2)
          order by priority, sort_key
          limit 2`,
        [entry.sessionId, entryId],
      );

      const sortKey =
        nextTwo.rows.length >= 2
          ? (
              (Number(nextTwo.rows[0].sort_key) +
                Number(nextTwo.rows[1].sort_key)) /
              2
            ).toString()
          : await this.entries.tailSortKey(entry.sessionId, tx);

      await tx.query(
        `update clinic.queue_entries
            set sort_key = $2, defer_count = defer_count + 1
          where id = $1`,
        [entryId, sortKey],
      );

      const updated = await this.requireEntry(clinicId, entryId, tx);
      await this.record(
        updated,
        'deferred',
        entry.status,
        updated.status,
        actor,
        tx,
      );
      await this.sessions.bumpRevision(session.id, tx);
      return updated;
    });
  }

  // -------------------------------------------------------------------------

  /** `waiting → called`, stamping the grace deadline from clinic policy. */
  private async callEntry(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    tx: SqlExecutor,
  ): Promise<QueueEntry> {
    const policy = await this.clinics.findPolicy(clinicId, tx);
    const graceMinutes = policy?.gracePeriodMinutes ?? 10;

    return this.applyTransition(
        clinicId,
        entryId,
        {
          to: QueueStatus.Called,
          from: [QueueStatus.Waiting],
          assignment: `set status = 'called',
                           called_at = now(),
                           grace_expires_at =
                             now() + make_interval(mins => ${graceMinutes})`,
        event: 'called',
      },
      actor,
      tx,
    );
  }

  private async transition(
    clinicId: string,
    entryId: string,
    actor: QueueActor,
    db: SqlExecutor | undefined,
    spec: TransitionSpec,
  ): Promise<QueueEntry> {
    return this.inTransaction(db, async (tx) => {
      const entry = await this.requireEntry(clinicId, entryId, tx);
      await this.sessions.lockForUpdate(clinicId, entry.sessionId, tx);
      return this.applyTransition(clinicId, entryId, spec, actor, tx);
    });
  }

  /**
   * The one place a status actually changes.
   *
   * The precondition lives in the WHERE clause, so two callers racing this
   * cannot both succeed. Nought rows changed means somebody moved first, and
   * the answer depends on where the entry ended up: already there is success,
   * anywhere else is a conflict the caller has to see.
   */
  private async applyTransition(
    clinicId: string,
    entryId: string,
    spec: TransitionSpec,
    actor: QueueActor,
    tx: SqlExecutor,
  ): Promise<QueueEntry> {
    const before = await this.requireEntry(clinicId, entryId, tx);

    let result;
    try {
      result = await tx.query(
        `update clinic.queue_entries
            ${spec.assignment}
          where id = $1 and clinic_id = $2 and status = any($3)`,
        [entryId, clinicId, spec.from],
      );
    } catch (error) {
      // The "one at a time" indexes. Somebody else got there first, and the
      // caller's board is stale rather than broken — so this is a conflict
      // they can recover from, not a constraint name in a 500.
      if (isUniqueViolation(error, 'queue_one_in_service_uq')) {
        throw new QueueError(
          QueueErrorCode.Conflict,
          'Another patient is already with the doctor.',
          error,
        );
      }
      if (isUniqueViolation(error, 'queue_one_called_uq')) {
        throw new QueueError(
          QueueErrorCode.Conflict,
          'Another patient has just been called.',
          error,
        );
      }
      throw error;
    }

    if (result.rowCount === 0) {
      const now = await this.requireEntry(clinicId, entryId, tx);
      // Already where the caller wanted it: a double-click, not a failure.
      if (now.status === spec.to) return now;

      throw new QueueError(
        QueueErrorCode.InvalidTransition,
        `A patient who is ${now.status} cannot become ${spec.to}.`,
        undefined,
        { status: now.status },
      );
    }

    const updated = await this.requireEntry(clinicId, entryId, tx);
    await this.record(updated, spec.event, before.status, spec.to, actor, tx);
    await this.sessions.bumpRevision(updated.sessionId, tx);
    return updated;
  }

  private async requireEntry(
    clinicId: string,
    entryId: string,
    tx: SqlExecutor,
  ): Promise<QueueEntry> {
    const entry = await this.entries.findById(clinicId, entryId, tx);
    if (entry === null) {
      throw new QueueError(
        QueueErrorCode.EntryNotFound,
        'No such patient in the queue.',
      );
    }
    return entry;
  }

  /**
   * The session, locked, and confirmed to be running.
   *
   * A paused session keeps its order and its patients; it simply stops
   * advancing, so every command that moves somebody is refused until it
   * resumes.
   */
  private async requireRunningSession(
    clinicId: string,
    sessionId: string,
    tx: SqlExecutor,
  ) {
    const session = await this.sessions.lockForUpdate(clinicId, sessionId, tx);
    if (session.status !== ClinicSessionStatus.Open) {
      throw new QueueError(
        QueueErrorCode.SessionNotRunning,
        session.status === ClinicSessionStatus.Paused
          ? 'The queue is paused.'
          : 'The queue is not open.',
        undefined,
        { sessionStatus: session.status },
      );
    }
    return session;
  }

  /** Append to the trail, in the same transaction as the change. */
  private async record(
    entry: QueueEntry,
    eventType: string,
    fromStatus: string | null,
    toStatus: string | null,
    actor: QueueActor,
    tx: SqlExecutor,
  ): Promise<void> {
    await tx.query(
      `insert into clinic.queue_events
         (entry_id, session_id, event_type, from_status, to_status,
          performed_by_member_id, performed_by_auth_user_id, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.id,
        entry.sessionId,
        eventType,
        fromStatus,
        toStatus,
        actor.memberId ?? null,
        actor.authUserId ?? null,
        actor.reason ?? null,
      ],
    );
  }

  /**
   * Run work in a transaction, or join the caller's.
   *
   * A workflow already holds one, and opening a second would deadlock against
   * the session lock the first is holding.
   */
  private inTransaction<T>(
    db: SqlExecutor | undefined,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    return db === undefined ? this.database.transaction(work) : work(db);
  }
}

interface TransitionSpec {
  to: QueueStatus;
  from: readonly QueueStatus[];
  assignment: string;
  event: string;
}

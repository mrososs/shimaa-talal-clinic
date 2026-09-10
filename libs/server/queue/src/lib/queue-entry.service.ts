import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import {
  QueueStatus,
  type QueueEntry,
  type QueueEntrySource,
} from '@clinic/contracts';
import { QueueError, QueueErrorCode } from './queue.errors';

interface EntryRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  session_id: string;
  appointment_id: string | null;
  child_id: string;
  guardian_id: string | null;
  source: string;
  ticket_number: number;
  status: string;
  priority: number;
  visit_reason: string | null;
  checked_in_at: Date;
  called_at: Date | null;
  grace_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  defer_count: number;
}

interface SessionEntryRow extends EntryRow {
  emergency_reason: string | null;
}

/**
 * `sort_key` and `priority` are absent from this projection on purpose.
 *
 * They are ordering mechanics. A caller that could read them would be tempted
 * to sort with them, and then the order would live in two places. The server's
 * answer is the order of the array it returns.
 */
const COLUMNS = `
  id, clinic_id, session_id, appointment_id, child_id, guardian_id,
  source, ticket_number, status, priority, visit_reason,
  checked_in_at, called_at, grace_expires_at, started_at, completed_at,
  defer_count
`;

/** Statuses that still occupy a place in the running queue. */
export const ACTIVE_STATUSES = [
  QueueStatus.Waiting,
  QueueStatus.Called,
  QueueStatus.InService,
] as const;

/** Emergencies sort ahead of this; everyone else sits on it. */
export const NORMAL_PRIORITY = 100;
export const EMERGENCY_PRIORITY = 10;

/**
 * The gap left between consecutive sort keys.
 *
 * Large enough that an insertion between two neighbours can take their midpoint
 * without running out of room — roughly fifty successive midpoint inserts
 * between the *same* pair before `numeric(20,6)` precision matters, which is far
 * beyond a clinic day.
 */
export const SORT_KEY_GAP = 1000;

/**
 * An entry as a board shows it, before names are attached.
 *
 * `emergencyReason` is here and not on `QueueEntry` because it is staff-facing
 * by nature: it says why somebody was moved ahead, which is the question a
 * colleague asks and the one an audit asks later. A parent is told an emergency
 * came in, never whose or what.
 */
export type QueueSessionEntry = QueueEntry & {
  emergencyReason: string | null;
};

export interface CreateEntryInput {
  clinicId: string;
  sessionId: string;
  childId: string;
  guardianId?: string | null;
  /** Null makes this a walk-in; a value makes it a check-in. */
  appointmentId?: string | null;
  visitReason?: string | null;
  createdByMemberId?: string | null;
}

/**
 * Queue entries: creating them, reading them, and the order they are served in.
 *
 * Every write here expects to run inside a transaction that already holds the
 * session's row lock. That lock is what makes ticket allocation and sort-key
 * placement safe — two check-ins at the same instant would otherwise read the
 * same "next number" and both take it.
 */
@Injectable()
export class QueueEntryService {
  constructor(private readonly database: DatabaseService) {}

  async findById(
    clinicId: string,
    entryId: string,
    db: SqlExecutor = this.database,
  ): Promise<QueueEntry | null> {
    const result = await db.query<EntryRow>(
      `select ${COLUMNS} from clinic.queue_entries
        where id = $1 and clinic_id = $2`,
      [entryId, clinicId],
    );
    return result.rows[0] ? toEntry(result.rows[0]) : null;
  }

  /**
   * The running queue, in the order patients will actually be served.
   *
   * `(priority, sort_key)` and nothing else. A client that sorted by ticket
   * number would be wrong the moment an emergency arrived.
   */
  async listActive(
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<QueueEntry[]> {
    const result = await db.query<EntryRow>(
      `select ${COLUMNS} from clinic.queue_entries
        where session_id = $1 and status = any($2)
        order by priority, sort_key`,
      [sessionId, ACTIVE_STATUSES],
    );
    return result.rows.map(toEntry);
  }

  /**
   * Everything that happened in this session, finished rows included.
   *
   * The board shows the whole half-day, not just who is still waiting: the desk
   * needs to see that a patient was completed as much as that one is next, and
   * a row vanishing the moment it finished would read as a mistake.
   */
  async listForSession(
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<QueueSessionEntry[]> {
    const result = await db.query<SessionEntryRow>(
      `select ${COLUMNS}, emergency_reason from clinic.queue_entries
        where session_id = $1
        order by priority, sort_key, checked_in_at`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      ...toEntry(row),
      emergencyReason: row.emergency_reason,
    }));
  }

  /**
   * Every child of this guardian who is currently in a queue.
   *
   * Scoped by `guardian_id` in the query rather than filtered afterwards. A
   * check that happens after the read is a check somebody eventually forgets,
   * and what it would leak is another family's place in the queue.
   */
  async listActiveForGuardian(
    clinicId: string,
    guardianId: string,
    db: SqlExecutor = this.database,
  ): Promise<QueueEntry[]> {
    const result = await db.query<EntryRow>(
      `select ${COLUMNS} from clinic.queue_entries
        where clinic_id = $1 and guardian_id = $2 and status = any($3)
        order by checked_in_at`,
      [clinicId, guardianId, ACTIVE_STATUSES],
    );
    return result.rows.map(toEntry);
  }

  /**
   * Every entry belonging to these children, in these sessions.
   *
   * Scoped by child rather than by `guardian_id`, because `guardian_children`
   * is the ownership predicate the rest of the system uses: a father must see
   * his child's turn even when the mother's name is the one reception wrote on
   * the entry, and a walk-in registered with no guardian at all is still that
   * child's turn.
   *
   * Every status, not only the active ones. A parent whose turn was missed
   * needs to be told so, and one whose visit just finished should see it end
   * rather than watch the screen go blank.
   */
  async listForChildrenInSessions(
    clinicId: string,
    childIds: readonly string[],
    sessionIds: readonly string[],
    db: SqlExecutor = this.database,
  ): Promise<QueueEntry[]> {
    if (childIds.length === 0 || sessionIds.length === 0) return [];

    const result = await db.query<EntryRow>(
      `select ${COLUMNS} from clinic.queue_entries
        where clinic_id = $1
          and child_id = any($2)
          and session_id = any($3)
        order by checked_in_at`,
      [clinicId, [...childIds], [...sessionIds]],
    );
    return result.rows.map(toEntry);
  }

  /** The entry a given appointment produced, if it has been checked in. */
  async findByAppointment(
    clinicId: string,
    appointmentId: string,
    db: SqlExecutor = this.database,
  ): Promise<QueueEntry | null> {
    const result = await db.query<EntryRow>(
      `select ${COLUMNS} from clinic.queue_entries
        where clinic_id = $1
          and appointment_id = $2
          and status <> 'cancelled'
        limit 1`,
      [clinicId, appointmentId],
    );
    return result.rows[0] ? toEntry(result.rows[0]) : null;
  }

  /**
   * Add a patient to the end of the queue.
   *
   * The ticket number comes from the session's own counter, incremented in the
   * same statement that reads it, and the sort key lands past everyone already
   * waiting. Both are safe only because the caller holds the session lock —
   * hence the required executor.
   *
   * Checking the same appointment in twice is not an error: it is a
   * double-click, and the existing entry comes back instead.
   */
  async create(input: CreateEntryInput, tx: SqlExecutor): Promise<QueueEntry> {
    if (input.appointmentId) {
      const existing = await this.findByAppointment(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (existing !== null) return existing;
    }

    const ticket = await tx.query<{ next_ticket_number: number }>(
      `update clinic.clinic_sessions
          set next_ticket_number = next_ticket_number + 1
        where id = $1
        returning next_ticket_number - 1 as next_ticket_number`,
      [input.sessionId],
    );
    const ticketNumber = ticket.rows[0]?.next_ticket_number;
    if (ticketNumber === undefined) {
      throw new QueueError(
        QueueErrorCode.SessionNotRunning,
        'No such session.',
      );
    }

    const sortKey = await this.tailSortKey(input.sessionId, tx);

    const result = await tx.query<EntryRow>(
      `insert into clinic.queue_entries
         (clinic_id, session_id, appointment_id, child_id, guardian_id,
          source, ticket_number, sort_key, visit_reason, created_by_member_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning ${COLUMNS}`,
      [
        input.clinicId,
        input.sessionId,
        input.appointmentId ?? null,
        input.childId,
        input.guardianId ?? null,
        input.appointmentId ? 'appointment' : 'walk_in',
        ticketNumber,
        sortKey,
        input.visitReason ?? null,
        input.createdByMemberId ?? null,
      ],
    );

    return toEntry(result.rows[0]);
  }

  /**
   * How many patients are ahead of this one, right now.
   *
   * A count, never arithmetic on ticket numbers. `myNumber - nowServing` is
   * wrong the moment anybody is reordered, deferred, or overtaken by an
   * emergency — and all three are ordinary events.
   *
   * The row-comparison form uses `queue_order_idx` directly.
   */
  async aheadCount(
    entryId: string,
    db: SqlExecutor = this.database,
  ): Promise<number> {
    const result = await db.query<{ ahead: string }>(
      `with mine as (
         select session_id, priority, sort_key
           from clinic.queue_entries where id = $1
       )
       select count(*)::text as ahead
         from clinic.queue_entries q, mine
        where q.session_id = mine.session_id
          and q.status = any($2)
          and (q.priority, q.sort_key) < (mine.priority, mine.sort_key)`,
      [entryId, ACTIVE_STATUSES],
    );
    return Number(result.rows[0]?.ahead ?? '0');
  }

  /** The next patient due, or null when nobody is waiting. */
  async nextWaiting(
    sessionId: string,
    db: SqlExecutor = this.database,
  ): Promise<QueueEntry | null> {
    const result = await db.query<EntryRow>(
      `select ${COLUMNS} from clinic.queue_entries
        where session_id = $1 and status = 'waiting'
        order by priority, sort_key
        limit 1`,
      [sessionId],
    );
    return result.rows[0] ? toEntry(result.rows[0]) : null;
  }

  /** The single entry in a session holding an exclusive operational status. */
  async findByStatus(
    sessionId: string,
    status: QueueStatus,
    db: SqlExecutor = this.database,
  ): Promise<QueueEntry | null> {
    const result = await db.query<EntryRow>(
      `select ${COLUMNS} from clinic.queue_entries
        where session_id = $1 and status = $2
        limit 1`,
      [sessionId, status],
    );
    return result.rows[0] ? toEntry(result.rows[0]) : null;
  }

  /**
   * A sort key past everyone currently in the queue.
   *
   * Computed from the maximum rather than from a count, because cancelled and
   * completed rows keep their keys and a count would collide with them.
   */
  async tailSortKey(sessionId: string, db: SqlExecutor): Promise<string> {
    const result = await db.query<{ next: string }>(
      `select coalesce(max(sort_key), 0) + $2 as next
         from clinic.queue_entries where session_id = $1`,
      [sessionId, SORT_KEY_GAP],
    );
    return result.rows[0].next;
  }

  /**
   * A sort key that places an entry between two neighbours.
   *
   * The midpoint touches exactly one row. A dense `position` integer would
   * rewrite every row below the insertion, fight concurrent check-ins, and make
   * "patients ahead" briefly wrong for everyone else mid-transaction.
   */
  async midpointSortKey(
    sessionId: string,
    entryId: string,
    beforeEntryId: string | null,
    afterEntryId: string | null,
    db: SqlExecutor,
  ): Promise<string> {
    if (
      (beforeEntryId === null && afterEntryId === null) ||
      beforeEntryId === entryId ||
      afterEntryId === entryId ||
      (beforeEntryId !== null && beforeEntryId === afterEntryId)
    ) {
      throw invalidMove();
    }

    const result = await db.query<{
      id: string;
      priority: number;
      sort_key: string;
    }>(
      `select id, priority, sort_key::text as sort_key
         from clinic.queue_entries
        where session_id = $1 and status = 'waiting'
        order by priority, sort_key
        for update`,
      [sessionId],
    );

    const moving = result.rows.find((row) => row.id === entryId);
    if (moving === undefined) throw invalidMove();

    const line = result.rows.filter((row) => row.id !== entryId);
    const beforeIndex =
      beforeEntryId === null
        ? -1
        : line.findIndex((row) => row.id === beforeEntryId);
    const afterIndex =
      afterEntryId === null
        ? -1
        : line.findIndex((row) => row.id === afterEntryId);

    if (
      (beforeEntryId !== null && beforeIndex < 0) ||
      (afterEntryId !== null && afterIndex < 0)
    ) {
      throw invalidMove();
    }

    if (
      (beforeIndex >= 0 && line[beforeIndex].priority !== moving.priority) ||
      (afterIndex >= 0 && line[afterIndex].priority !== moving.priority)
    ) {
      throw invalidMove();
    }

    let lower: (typeof line)[number] | undefined;
    let upper: (typeof line)[number] | undefined;

    if (beforeIndex >= 0 && afterIndex >= 0) {
      if (afterIndex + 1 !== beforeIndex) throw invalidMove();
      lower = line[afterIndex];
      upper = line[beforeIndex];
    } else if (beforeIndex >= 0) {
      upper = line[beforeIndex];
      lower = line[beforeIndex - 1];
    } else {
      lower = line[afterIndex];
      upper = line[afterIndex + 1];
    }

    if (lower?.priority !== undefined && lower.priority !== moving.priority) {
      lower = undefined;
    }
    if (upper?.priority !== undefined && upper.priority !== moving.priority) {
      upper = undefined;
    }

    const lowerKey = lower ? Number(lower.sort_key) : null;
    const upperKey = upper ? Number(upper.sort_key) : null;
    if (lowerKey !== null && upperKey !== null) {
      return ((lowerKey + upperKey) / 2).toString();
    }
    if (upperKey !== null) return (upperKey / 2).toString();
    if (lowerKey !== null) return (lowerKey + SORT_KEY_GAP).toString();

    return SORT_KEY_GAP.toString();
  }
}

function invalidMove(): QueueError {
  return new QueueError(
    QueueErrorCode.InvalidTransition,
    'The requested queue position is not valid.',
  );
}

function toEntry(row: EntryRow): QueueEntry {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    appointmentId: row.appointment_id,
    childId: row.child_id,
    guardianId: row.guardian_id,
    source: row.source as QueueEntrySource,
    ticketNumber: row.ticket_number,
    status: row.status as QueueStatus,
    // The numeric priority stays server-side; a client gets the fact, not the
    // mechanism.
    isEmergency: row.priority < NORMAL_PRIORITY,
    visitReason: row.visit_reason,
    checkedInAt: row.checked_in_at.toISOString(),
    calledAt: row.called_at?.toISOString() ?? null,
    graceExpiresAt: row.grace_expires_at?.toISOString() ?? null,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    deferCount: row.defer_count,
  };
}

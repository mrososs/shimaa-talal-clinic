import type {
  AppointmentListItem,
  ParentAppointmentSummary,
} from '../domain/appointment';
import type {
  ClinicSession,
  ParentSessionView,
} from '../domain/clinic-session';
import type { ParentQueueEntry, QueueBoardEntry } from '../domain/queue-entry';
import type { ClinicSessionStatus } from '../domain/clinic-session-status';
import type { DoctorPresence } from '../domain/doctor-presence';
import type { QueueStatus } from '../domain/queue-status';

/**
 * `GET /clinic/queue` — the staff board.
 *
 * Composed, not a table dump. The screen staff work from mixes two things: the
 * patients who are actually here, and the appointments still expected. Only the
 * first are queue entries; the second have no entry yet and must not be given
 * one just so a list looks uniform.
 *
 * `entries` arrives in service order. Clients render it as given and never sort.
 */
export interface QueueBoard {
  session: ClinicSession;

  /** In service order: emergencies first, then by the server's sort key. */
  entries: QueueBoardEntry[];

  /** Today's confirmed appointments with no queue entry — nobody has arrived yet. */
  notArrived: AppointmentListItem[];

  /** Mirrors `session.revision`, so a poll can be answered cheaply. */
  revision: number;
}

/**
 * A poll that found nothing new.
 *
 * A queue board is polled every few seconds by several staff at once. Sending
 * the whole board each time to say "unchanged" is the difference between a
 * cheap request and a wasteful one.
 */
export interface UnchangedResponse {
  changed: false;
  revision: number;
}

export type QueueBoardResponse = QueueBoard | UnchangedResponse;

/** `true` when a polled response actually carries data. */
export function isUnchanged(
  response: QueueBoardResponse | ParentQueueResponse,
): response is UnchangedResponse {
  return (response as UnchangedResponse).changed === false;
}

/** One child's live state, as their guardian sees it. */
export interface ParentQueueItem {
  childId: string;
  childName: string;

  /** Today's appointment, if there is one. `null` for a walk-in. */
  appointment: ParentAppointmentSummary | null;

  /** `null` until reception checks them in. */
  queueEntry: ParentQueueEntry | null;

  session: ParentSessionView;
}

/**
 * `GET /queue/me` — the parent's live view.
 *
 * An array because a guardian may have two children in the clinic at once. It
 * contains this guardian's children and nothing else: never the clinic's queue,
 * never another patient's number or name.
 */
export interface ParentQueueView {
  items: ParentQueueItem[];
  revision: number;
}

export type ParentQueueResponse = ParentQueueView | UnchangedResponse;

/** The one-time secret returned to reception when it creates a guest link. */
export interface QueueGuestLink {
  token: string;
  expiresAt: string;
}

/** Public, deliberately anonymous facts rendered by a guest queue link. */
export interface GuestQueueView {
  ticketNumber: number;
  status: QueueStatus;
  aheadCount: number;
  nowServingTicketNumber: number | null;
  graceExpiresAt: string | null;
  sessionStatus: ClinicSessionStatus;
  doctorPresence: DoctorPresence;
  delayMinutes: number | null;
  revision: number;
  expiresAt: string;
}

/**
 * `@clinic/server-queue` — the live queue.
 *
 * Owns who is waiting, in what order, and every transition between arriving and
 * leaving. Owns nothing about bookings: `appointmentId` is an opaque uuid here,
 * and the workflows above this library are what join the two.
 *
 * Intent-shaped services only; row shapes and SQL stay private. In particular
 * `sort_key` and the numeric priority never leave — they are ordering
 * mechanics, and a caller that could read them would sort with them.
 */
export * from './lib/queue.module';
export {
  QueueEntryService,
  ACTIVE_STATUSES,
  EMERGENCY_PRIORITY,
  NORMAL_PRIORITY,
  SORT_KEY_GAP,
  type CreateEntryInput,
} from './lib/queue-entry.service';
export {
  QueueCommandService,
  type QueueActor,
  type QueueAdvanceResult,
} from './lib/queue-command.service';
export { QueueError, QueueErrorCode } from './lib/queue.errors';

// The board is composed a layer up, in @clinic/server-workflows: it mixes this
// session's entries with the appointments still expected and the names behind
// both, and this library may not see either.
export type { QueueSessionEntry } from './lib/queue-entry.service';

import { computed, ref, shallowRef } from 'vue';
import {
  ClinicSessionStatus,
  DoctorPresence,
  QueueStatus,
  isUnchanged,
  type ParentQueueItem,
} from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { apiMessage } from '../../../shared/messages';
import { queueApi } from '../../../runtime';

/**
 * Fifteen seconds.
 *
 * Slower than the clinic's own board on purpose: staff are operating the queue
 * and need it to feel immediate, a parent is watching it and needs it to be
 * true. The difference is a phone battery.
 */
export const QUEUE_POLL_MS = 15_000;

/**
 * How close counts as "nearly your turn".
 *
 * Two patients, because at roughly six minutes each that is about the time it
 * takes to put shoes on and walk in. It is a presentation threshold and nothing
 * more — there is no `near_turn` on the server, and there should not be: it
 * would be a status that changes without anything happening.
 */
export const NEAR_TURN_AHEAD = 2;

/**
 * The family's live queue: what it is, and how it stays current.
 *
 * Everything factual comes from the server and is rendered as given. Nothing
 * here counts patients, orders anyone, or decides whose turn is next — the one
 * derived value is `isNear`, which is a threshold on a number the server
 * supplied, not a rule about the queue.
 *
 * State lives here rather than in the page so that the page can be read: a
 * screen with nine states is hard enough to follow without fetch, polling,
 * revisions and error translation woven through it.
 */
export function useLiveQueue() {
  const items = shallowRef<ParentQueueItem[]>([]);
  const revision = ref<number | null>(null);

  /** True only for the very first read, so a poll never blanks the screen. */
  const loading = ref(true);
  const refreshing = ref(false);
  const failure = ref<string | null>(null);
  const updatedAt = ref<number | null>(null);
  /** The entry a deferral is in flight for, so exactly one button disables. */
  const deferring = ref<string | null>(null);

  /** Items where the child is actually in the queue right now. */
  const active = computed(() =>
    items.value.filter(
      (item) =>
        item.queueEntry !== null && PENDING.includes(item.queueEntry.status),
    ),
  );

  /** Booked today, nobody has checked them in yet. */
  const expected = computed(() =>
    items.value.filter((item) => item.queueEntry === null),
  );

  /** Finished, missed or removed — the day is over for them. */
  const settled = computed(() =>
    items.value.filter(
      (item) =>
        item.queueEntry !== null && !PENDING.includes(item.queueEntry.status),
    ),
  );

  const session = computed(() => items.value[0]?.session ?? null);

  const paused = computed(
    () => session.value?.status === ClinicSessionStatus.Paused,
  );

  const doctorAway = computed(
    () =>
      session.value !== null &&
      session.value.doctorPresence !== DoctorPresence.Arrived,
  );

  /**
   * Arrival order, so a slow poll cannot undo a fresh read.
   *
   * A fifteen-second tick and the re-read after a deferral overlap easily on a
   * phone's connection. If the tick was sent first and lands second it carries
   * the count from before the deferral, and the number a parent is watching
   * would jump backwards.
   */
  const sequence = createSequence();

  async function read(since?: number): Promise<void> {
    const ticket = sequence.next();
    const response = await queueApi.mine(since);
    if (!sequence.accept(ticket)) return;

    updatedAt.value = Date.now();
    if (isUnchanged(response)) {
      revision.value = response.revision;
      return;
    }
    items.value = response.items;
    revision.value = response.revision;
  }

  /** A full read: used on entering the screen, on retry, and on resume. */
  async function refresh(): Promise<void> {
    refreshing.value = true;
    try {
      await read();
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  }

  async function poll(): Promise<void> {
    try {
      await read(revision.value ?? undefined);
      // A poll that succeeds clears the banner a previous one raised: the
      // connection came back, and leaving it up would be a lie.
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  const polling = usePolling(poll, {
    intervalMs: QUEUE_POLL_MS,
    onResume: () => void refresh(),
  });

  /**
   * "Let the next person go."
   *
   * The clinic's limit is the server's to enforce, and a refusal comes back as
   * a sentence a parent can read. Either way the view is re-read afterwards:
   * the whole point of deferring is that the count changes, and the entry the
   * endpoint returns says nothing about where the rest of the queue now is.
   */
  async function defer(entryId: string): Promise<void> {
    if (deferring.value !== null) return;
    deferring.value = entryId;
    failure.value = null;
    try {
      await queueApi.defer(entryId);
      await read();
    } catch (error) {
      failure.value = apiMessage(error);
      await read().catch(() => undefined);
    } finally {
      deferring.value = null;
    }
  }

  /** Entering the screen: read immediately, then keep it current. */
  async function open(): Promise<void> {
    await refresh();
    polling.start();
  }

  function close(): void {
    polling.stop();
  }

  return {
    items,
    revision,
    loading,
    refreshing,
    failure,
    updatedAt,
    deferring,
    active,
    expected,
    settled,
    session,
    paused,
    doctorAway,
    polling,
    open,
    close,
    refresh,
    defer,
  };
}

/** Statuses whose turn has not happened yet. */
const PENDING: readonly QueueStatus[] = [
  QueueStatus.Waiting,
  QueueStatus.Called,
  QueueStatus.InService,
];

/**
 * Whether "skip my turn" is offered at all.
 *
 * Only while still waiting — once called, the turn is happening and giving it
 * up is a different decision the clinic makes, not the parent. And only within
 * the clinic's own limit, so a button that the server would refuse is never
 * drawn in the first place.
 */
export function canDefer(
  item: ParentQueueItem,
  maxSelfDefers: number,
): boolean {
  const entry = item.queueEntry;
  return (
    entry !== null &&
    entry.status === QueueStatus.Waiting &&
    entry.deferCount < maxSelfDefers
  );
}

/** How many deferrals this family has left today. */
export function defersLeft(
  item: ParentQueueItem,
  maxSelfDefers: number,
): number {
  return Math.max(0, maxSelfDefers - (item.queueEntry?.deferCount ?? 0));
}

/** Nearly their turn — a threshold on the server's count, not a status. */
export function isNear(item: ParentQueueItem): boolean {
  const entry = item.queueEntry;
  return (
    entry !== null &&
    entry.status === QueueStatus.Waiting &&
    entry.aheadCount > 0 &&
    entry.aheadCount <= NEAR_TURN_AHEAD
  );
}

export type LiveQueueState = ReturnType<typeof useLiveQueue>;

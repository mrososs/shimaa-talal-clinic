import { computed, ref, shallowRef } from 'vue';
import {
  ClinicSessionStatus,
  QueueStatus,
  isUnchanged,
  type AppointmentListItem,
  type ClinicSession,
  type QueueBoardEntry,
} from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { apiMessage } from '../../../shared/messages';
import { queueApi } from '../../../runtime';

/** Five seconds. Long enough to be cheap, short enough that nobody refreshes. */
export const BOARD_POLL_MS = 5_000;

/**
 * The board's state, and every way it changes.
 *
 * One rule runs through all of it: **the server owns the queue, and this only
 * ever displays what it last said.** No command guesses at the result and no
 * list is sorted here. `entries` is rendered in the order it arrives, because
 * a client that sorted by ticket number would be wrong the moment an emergency
 * was admitted.
 *
 * After a command the board is re-read in full rather than patched with the one
 * row that came back. Half these commands move other people: calling the next
 * patient completes whoever was in the room, and an emergency changes what
 * every waiting family is told. Folding in a single row would leave the rest of
 * the screen quietly stale — and a failed command leaves it stale in a way that
 * *looks* fine, which is worse.
 */
export function useQueueBoard() {
  const sessions = shallowRef<ClinicSession[]>([]);
  const sessionId = ref<string | null>(null);

  const session = shallowRef<ClinicSession | null>(null);
  const entries = shallowRef<QueueBoardEntry[]>([]);
  const notArrived = shallowRef<AppointmentListItem[]>([]);
  const revision = ref<number | null>(null);

  const loading = ref(true);
  const failure = ref<string | null>(null);
  /** The id of whatever command is in flight, so exactly one button disables. */
  const working = ref<string | null>(null);
  const updatedAt = ref<number | null>(null);

  // --- what the board is made of ---------------------------------------

  const inService = computed(
    () => entries.value.find((e) => e.status === QueueStatus.InService) ?? null,
  );
  const called = computed(
    () => entries.value.find((e) => e.status === QueueStatus.Called) ?? null,
  );
  const waiting = computed(() =>
    entries.value.filter((e) => e.status === QueueStatus.Waiting),
  );
  /** Finished, missed or removed — kept visible, because a row that vanished
   * the moment it completed would read as a mistake at the desk. */
  const settled = computed(() =>
    entries.value.filter(
      (e) =>
        e.status === QueueStatus.Done ||
        e.status === QueueStatus.Missed ||
        e.status === QueueStatus.Cancelled,
    ),
  );

  const running = computed(
    () => session.value?.status === ClinicSessionStatus.Open,
  );

  // --- reading ----------------------------------------------------------

  /**
   * Arrival order, so a slow poll cannot undo a fast command.
   *
   * A tick and a command's own re-read are in flight together constantly. If
   * the tick was sent first and lands second, it describes the board as it was
   * before the command — and the screen would visibly go backwards for one
   * interval, which is when a receptionist presses the button again.
   */
  const sequence = createSequence();

  async function read(since?: number): Promise<void> {
    const id = sessionId.value;
    if (id === null) return;

    const ticket = sequence.next();
    const response = await queueApi.board(id, since);
    if (!sequence.accept(ticket)) return;

    updatedAt.value = Date.now();
    if (isUnchanged(response)) {
      revision.value = response.revision;
      return;
    }

    session.value = response.session;
    entries.value = response.entries;
    notArrived.value = response.notArrived;
    revision.value = response.revision;
  }

  /** A full read. Used after a command, and after the tab comes back. */
  async function refresh(): Promise<void> {
    failure.value = null;
    try {
      await read();
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  async function poll(): Promise<void> {
    try {
      await read(revision.value ?? undefined);
      // A poll that succeeds clears a failure the previous one reported: the
      // connection came back, and leaving the banner up would be a lie.
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    }
  }

  const polling = usePolling(poll, {
    intervalMs: BOARD_POLL_MS,
    // A board hidden for ten minutes holds a ten-minute-old revision, and
    // sending it back would be answered "unchanged" against a board that has
    // moved on. Come back with a full read instead.
    onResume: () => void refresh(),
  });

  /** Load the day, pick a session, and start watching it. */
  async function open(today?: string): Promise<void> {
    loading.value = true;
    failure.value = null;
    try {
      sessions.value = await queueApi.sessions(today);
      // The one that is running, else the first of the day. A closed morning
      // should not be what the evening desk is shown.
      const live =
        sessions.value.find((s) => s.status === ClinicSessionStatus.Open) ??
        sessions.value.find((s) => s.status !== ClinicSessionStatus.Closed) ??
        sessions.value[0];
      sessionId.value = live?.id ?? null;
      session.value = live ?? null;
      revision.value = null;
      if (sessionId.value !== null) await read();
      polling.start();
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
    }
  }

  async function select(id: string): Promise<void> {
    sessionId.value = id;
    revision.value = null;
    entries.value = [];
    notArrived.value = [];
    await refresh();
  }

  // --- commands ---------------------------------------------------------

  /**
   * Run one command, then re-read.
   *
   * The re-read happens whether or not the command succeeded. A 409 means
   * somebody else moved first, and the only useful response to that is to show
   * what is actually true now — the board heals instead of arguing.
   */
  async function run(
    key: string,
    command: () => Promise<unknown>,
  ): Promise<void> {
    if (working.value !== null) return;
    working.value = key;
    failure.value = null;
    try {
      await command();
      await read();
    } catch (error) {
      failure.value = apiMessage(error);
      await read().catch(() => undefined);
    } finally {
      working.value = null;
    }
  }

  return {
    sessions,
    sessionId,
    session,
    entries,
    notArrived,
    revision,
    updatedAt,
    loading,
    failure,
    working,
    inService,
    called,
    waiting,
    settled,
    running,
    polling,
    open,
    select,
    refresh,
    run,
  };
}

export type QueueBoardState = ReturnType<typeof useQueueBoard>;

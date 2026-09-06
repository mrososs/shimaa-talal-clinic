import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@clinic/api-client';
import type {
  AppointmentListItem,
  ClinicSession,
  QueueBoard,
  QueueBoardEntry,
} from '@clinic/contracts';

const api = {
  sessions: vi.fn(),
  board: vi.fn(),
  callNext: vi.fn(),
  call: vi.fn(),
};

vi.mock('../../../runtime', () => ({ queueApi: api }));

const { useQueueBoard } = await import('./useQueueBoard');

/**
 * The board's behaviour, without a browser or a server.
 *
 * Two properties matter more than the rest: a poll that is told "nothing
 * changed" must not blank the screen, and a command that fails must still leave
 * the desk looking at what is actually true.
 */
describe('useQueueBoard', () => {
  const session = (over: Partial<ClinicSession> = {}): ClinicSession =>
    ({
      id: 'session-1',
      clinicId: 'clinic-1',
      doctorMemberId: 'doctor-1',
      sessionDate: '2026-09-06',
      sessionKind: 'morning',
      plannedStart: '2026-09-06T07:00:00.000Z',
      plannedEnd: '2026-09-06T13:00:00.000Z',
      windowMinutes: 60,
      capacityPerWindow: 5,
      status: 'open',
      doctorPresence: 'arrived',
      delayMinutes: null,
      delayNote: null,
      avgConsultMinutes: 6,
      revision: 4,
      ...over,
    }) as ClinicSession;

  const entry = (over: Partial<QueueBoardEntry>): QueueBoardEntry =>
    ({
      id: 'e1',
      clinicId: 'clinic-1',
      sessionId: 'session-1',
      appointmentId: null,
      childId: 'c1',
      guardianId: 'g1',
      source: 'walk_in',
      ticketNumber: 1,
      status: 'waiting',
      isEmergency: false,
      visitReason: null,
      checkedInAt: '2026-09-06T08:00:00.000Z',
      calledAt: null,
      graceExpiresAt: null,
      startedAt: null,
      completedAt: null,
      deferCount: 0,
      emergencyReason: null,
      child: { id: 'c1', fullName: 'لين', dateOfBirth: null },
      guardian: { id: 'g1', fullName: 'أم لين', phoneE164: '+201000000000' },
      ...over,
    }) as QueueBoardEntry;

  const board = (over: Partial<QueueBoard> = {}): QueueBoard => ({
    session: session(),
    entries: [entry({ id: 'e1', ticketNumber: 1 })],
    notArrived: [] as AppointmentListItem[],
    revision: 4,
    ...over,
  });

  function mount() {
    const scope = effectScope();
    const state = scope.run(() => useQueueBoard());
    if (state === undefined) throw new Error('scope did not run');
    return { state, dispose: () => scope.stop() };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    api.sessions.mockResolvedValue([session()]);
    api.board.mockResolvedValue(board());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('watches the session that is actually running', async () => {
    api.sessions.mockResolvedValue([
      session({ id: 'closed-one', sessionKind: 'morning', status: 'closed' }),
      session({ id: 'live-one', sessionKind: 'evening', status: 'open' }),
    ]);
    const { state, dispose } = mount();

    await state.open('2026-09-06');

    // A closed morning is not what the evening desk should be shown.
    expect(state.sessionId.value).toBe('live-one');
    dispose();
  });

  it('renders the order it is given, without sorting', async () => {
    api.board.mockResolvedValue(
      board({
        entries: [
          entry({ id: 'urgent', ticketNumber: 9, isEmergency: true }),
          entry({ id: 'ordinary', ticketNumber: 2 }),
        ],
      }),
    );
    const { state, dispose } = mount();

    await state.open();

    // Ticket 9 ahead of ticket 2, because an emergency was admitted. Sorting by
    // number here would put the screen and the clinic into disagreement.
    expect(state.waiting.value.map((e) => e.id)).toEqual([
      'urgent',
      'ordinary',
    ]);
    dispose();
  });

  it('keeps the board when a poll is told nothing changed', async () => {
    const { state, dispose } = mount();
    await state.open();
    expect(state.entries.value).toHaveLength(1);

    api.board.mockResolvedValue({ changed: false, revision: 4 });
    await state.refresh();

    // The cheap answer carries no entries. Believing it literally would empty
    // the screen every five seconds.
    expect(state.entries.value).toHaveLength(1);
    expect(state.revision.value).toBe(4);
    dispose();
  });

  it('sends the revision it holds, and drops it after a full refresh', async () => {
    const { state, dispose } = mount();
    await state.open();

    await state.run('x', () => Promise.resolve());
    // A command's re-read asks for everything: the row that just changed is
    // exactly the row a "nothing changed" answer would hide.
    expect(api.board).toHaveBeenLastCalledWith('session-1', undefined);
    dispose();
  });

  it('re-reads after a command that somebody else beat it to', async () => {
    const { state, dispose } = mount();
    await state.open();
    api.board.mockClear();

    api.callNext.mockRejectedValue(
      new ApiClientError(409, {
        code: 'queue_conflict',
        message: 'Somebody moved first.',
      }),
    );

    await state.run('call-next', () => api.callNext('session-1'));

    // The board heals instead of arguing: it says what happened, and then shows
    // what is true now.
    expect(state.failure.value).toBe('تغيّر الطابور للتو — حدَّثنا الشاشة.');
    expect(api.board).toHaveBeenCalledTimes(1);
    dispose();
  });

  describe('staying current on its own', () => {
    it('polls at the desk cadence without anybody asking', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.open();
      api.board.mockClear();

      await vi.advanceTimersByTimeAsync(15_000);

      // Five seconds: three ticks, no interaction, no refresh button.
      expect(api.board).toHaveBeenCalledTimes(3);
      dispose();
    });

    it('shows what another dashboard did, with no user action', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.open();
      expect(state.waiting.value).toHaveLength(1);

      // Somebody at another desk calls the patient.
      api.board.mockResolvedValue(
        board({
          entries: [entry({ id: 'e1', status: 'called' })],
          revision: 8,
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);

      expect(state.waiting.value).toHaveLength(0);
      expect(state.called.value?.id).toBe('e1');
      dispose();
    });

    it('refreshes at once after this desk acts, without waiting for a tick', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.open();
      api.board.mockClear();

      api.board.mockResolvedValue(
        board({ entries: [entry({ id: 'e1', status: 'called' })] }),
      );
      await state.run('call-next', () => Promise.resolve());

      // No timer was advanced. The board is already current.
      expect(api.board).toHaveBeenCalledTimes(1);
      expect(state.called.value?.id).toBe('e1');
      dispose();
    });

    it('never lets a slow poll undo a fresh command', async () => {
      const { state, dispose } = mount();
      await state.open();

      let releaseSlow: ((value: unknown) => void) | undefined;
      api.board.mockReturnValueOnce(
        new Promise((resolve) => {
          releaseSlow = resolve;
        }),
      );
      const slow = state.refresh();

      api.board.mockResolvedValueOnce(
        board({
          entries: [entry({ id: 'e1', status: 'called' })],
          revision: 9,
        }),
      );
      await state.refresh();
      expect(state.called.value?.id).toBe('e1');

      releaseSlow?.(board({ entries: [entry({ id: 'e1' })], revision: 4 }));
      await slow;

      // The stale answer described a waiting patient. It is discarded.
      expect(state.called.value?.id).toBe('e1');
      expect(state.revision.value).toBe(9);
      dispose();
    });

    it('never blanks the board for a background refresh', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.open();
      expect(state.loading.value).toBe(false);

      let release: ((value: unknown) => void) | undefined;
      api.board.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);

      expect(state.loading.value).toBe(false);
      expect(state.entries.value).toHaveLength(1);

      release?.(board());
      dispose();
    });

    it('keeps the board on screen when a poll fails', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.open();

      api.board.mockRejectedValueOnce(
        new ApiClientError(0, { code: 'network', message: 'offline' }),
      );
      await vi.advanceTimersByTimeAsync(5_000);

      expect(state.entries.value).toHaveLength(1);
      expect(state.failure.value).not.toBeNull();
      dispose();
    });

    it('stops when the board is torn down', async () => {
      vi.useFakeTimers();
      const { state, dispose } = mount();
      await state.open();
      const before = api.board.mock.calls.length;

      dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(api.board.mock.calls.length).toBe(before);
    });
  });

  it('runs one command at a time', async () => {
    const { state, dispose } = mount();
    await state.open();

    let release: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = state.run('a', () => slow);
    const second = state.run('b', () => Promise.resolve());
    await second;

    expect(state.working.value).toBe('a');
    release?.();
    await first;
    expect(state.working.value).toBeNull();
    dispose();
  });
});

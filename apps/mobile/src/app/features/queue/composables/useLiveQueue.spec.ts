import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@clinic/api-client';
import type { ParentQueueItem } from '@clinic/contracts';

const api = { mine: vi.fn() };
vi.mock('../../../runtime', () => ({ queueApi: api }));

const { useLiveQueue, isNear, NEAR_TURN_AHEAD } = await import(
  './useLiveQueue'
);

/**
 * The family's live queue, without a phone or a server.
 *
 * The properties worth protecting: a poll told "nothing changed" must not blank
 * a screen a parent is reading, and a failed request must not silently leave a
 * stale number looking current.
 */
describe('useLiveQueue', () => {
  const session = (over: Partial<ParentQueueItem['session']> = {}) => ({
    status: 'open',
    doctorPresence: 'arrived',
    delayMinutes: null,
    avgConsultMinutes: 6,
    revision: 7,
    ...over,
  });

  const item = (over: Partial<ParentQueueItem> = {}): ParentQueueItem =>
    ({
      childId: 'c1',
      childName: 'لين',
      appointment: null,
      queueEntry: {
        id: 'e1',
        ticketNumber: 24,
        status: 'waiting',
        aheadCount: 3,
        calledAt: null,
        graceExpiresAt: null,
        estimatedWaitMinutes: { from: 20, to: 30 },
        deferCount: 0,
        isEmergency: false,
      },
      session: session(),
      ...over,
    }) as ParentQueueItem;

  const view = (items: ParentQueueItem[], revision = 7) => ({
    items,
    revision,
  });

  function mount() {
    const scope = effectScope();
    const state = scope.run(() => useLiveQueue());
    if (state === undefined) throw new Error('scope did not run');
    return { state, dispose: () => scope.stop() };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    api.mine.mockResolvedValue(view([item()]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks immediately on entering, without a revision', async () => {
    const { state, dispose } = mount();

    await state.open();

    expect(api.mine).toHaveBeenCalledWith(undefined);
    expect(state.loading.value).toBe(false);
    expect(state.items.value).toHaveLength(1);
    expect(state.polling.active.value).toBe(true);
    dispose();
  });

  it('reports the count the server sent, and does not compute one', async () => {
    const { state, dispose } = mount();
    await state.open();

    expect(state.active.value).toHaveLength(1);
    expect(state.active.value[0].queueEntry?.aheadCount).toBe(3);
    // Ticket 24 with 3 ahead: the two numbers are unrelated, which is the point.
    expect(state.active.value[0].queueEntry?.ticketNumber).toBe(24);
    dispose();
  });

  it('separates a booking with no turn from a turn in progress', async () => {
    api.mine.mockResolvedValue(
      view([
        item({ childId: 'booked', queueEntry: null }),
        item({ childId: 'waiting' }),
      ]),
    );
    const { state, dispose } = mount();
    await state.open();

    expect(state.expected.value.map((i) => i.childId)).toEqual(['booked']);
    expect(state.active.value.map((i) => i.childId)).toEqual(['waiting']);
    dispose();
  });

  it('treats a called turn as live and a missed one as settled', async () => {
    const called = item({
      childId: 'called',
      queueEntry: {
        ...(item().queueEntry as NonNullable<ParentQueueItem['queueEntry']>),
        status: 'called',
        aheadCount: 0,
        calledAt: '2026-09-06T09:00:00.000Z',
        graceExpiresAt: '2026-09-06T09:10:00.000Z',
      },
    });
    const missed = item({
      childId: 'missed',
      queueEntry: {
        ...(item().queueEntry as NonNullable<ParentQueueItem['queueEntry']>),
        status: 'missed',
        aheadCount: 0,
        estimatedWaitMinutes: null,
      },
    });
    api.mine.mockResolvedValue(view([called, missed]));

    const { state, dispose } = mount();
    await state.open();

    expect(state.active.value.map((i) => i.childId)).toEqual(['called']);
    expect(state.settled.value.map((i) => i.childId)).toEqual(['missed']);
    dispose();
  });

  it('surfaces a paused queue and an absent doctor', async () => {
    api.mine.mockResolvedValue(
      view([
        item({
          session: session({ status: 'paused', doctorPresence: 'en_route' }),
        }),
      ]),
    );
    const { state, dispose } = mount();
    await state.open();

    expect(state.paused.value).toBe(true);
    expect(state.doctorAway.value).toBe(true);
    dispose();
  });

  it('keeps what it has when a poll is told nothing changed', async () => {
    const { state, dispose } = mount();
    await state.open();
    expect(state.items.value).toHaveLength(1);

    api.mine.mockResolvedValue({ changed: false, revision: 7 });
    await state.refresh();

    // The cheap answer carries no items. Believing it literally would empty a
    // screen somebody is reading every fifteen seconds.
    expect(state.items.value).toHaveLength(1);
    expect(state.revision.value).toBe(7);
    dispose();
  });

  it('sends the revision it holds when polling, and none when refreshing', async () => {
    vi.useFakeTimers();
    const { state, dispose } = mount();
    await state.open();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.mine).toHaveBeenLastCalledWith(7);

    await state.refresh();
    expect(api.mine).toHaveBeenLastCalledWith(undefined);
    dispose();
  });

  it('explains a failure in Arabic and offers the state again on retry', async () => {
    api.mine.mockRejectedValueOnce(
      new ApiClientError(500, { code: 'boom', message: 'Internal' }),
    );
    const { state, dispose } = mount();

    await state.open();

    expect(state.failure.value).toBe('تعذَّر إتمام العملية. أعيدي المحاولة.');
    expect(state.loading.value).toBe(false);
    // Never the server's own words.
    expect(state.failure.value).not.toContain('Internal');

    api.mine.mockResolvedValue(view([item()]));
    await state.refresh();

    expect(state.failure.value).toBeNull();
    expect(state.items.value).toHaveLength(1);
    dispose();
  });

  it('clears the banner once a later poll succeeds', async () => {
    vi.useFakeTimers();
    const { state, dispose } = mount();
    await state.open();

    api.mine.mockRejectedValueOnce(
      new ApiClientError(0, { code: 'network', message: 'offline' }),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.failure.value).not.toBeNull();

    api.mine.mockResolvedValue(view([item()]));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.failure.value).toBeNull();
    dispose();
  });

  it('stops asking once the page is left', async () => {
    vi.useFakeTimers();
    const { state, dispose } = mount();
    await state.open();
    const before = api.mine.mock.calls.length;

    state.close();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(api.mine.mock.calls.length).toBe(before);
    expect(state.polling.active.value).toBe(false);
    dispose();
  });

  it('runs one loop when the page is entered twice', async () => {
    vi.useFakeTimers();
    const { state, dispose } = mount();
    await state.open();
    await state.open();
    const after = api.mine.mock.calls.length;

    await vi.advanceTimersByTimeAsync(15_000);

    // Two opens is two immediate reads; the loop after them is still one.
    expect(api.mine.mock.calls.length).toBe(after + 1);
    dispose();
  });

  it('says nothing is happening when the family has nothing today', async () => {
    api.mine.mockResolvedValue(view([], 0));
    const { state, dispose } = mount();
    await state.open();

    expect(state.items.value).toEqual([]);
    expect(state.session.value).toBeNull();
    expect(state.failure.value).toBeNull();
    dispose();
  });
});

describe('isNear', () => {
  const waiting = (aheadCount: number, status = 'waiting'): ParentQueueItem =>
    ({
      childId: 'c',
      childName: 'x',
      appointment: null,
      queueEntry: {
        id: 'e',
        ticketNumber: 1,
        status,
        aheadCount,
        calledAt: null,
        graceExpiresAt: null,
        estimatedWaitMinutes: null,
        deferCount: 0,
        isEmergency: false,
      },
      session: {
        status: 'open',
        doctorPresence: 'arrived',
        delayMinutes: null,
        avgConsultMinutes: 6,
        revision: 1,
      },
    }) as ParentQueueItem;

  it('is a threshold on the server’s count, not a status', () => {
    expect(isNear(waiting(NEAR_TURN_AHEAD))).toBe(true);
    expect(isNear(waiting(NEAR_TURN_AHEAD + 1))).toBe(false);
  });

  it('does not apply once they are next, or already called', () => {
    // "أنت التالي" is its own message; near-turn would be a weaker one.
    expect(isNear(waiting(0))).toBe(false);
    expect(isNear(waiting(1, 'called'))).toBe(false);
  });
});

import { effectScope, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './useCountdown';

/**
 * The only ticking clock in the parent app, and the rules that keep it honest.
 */
describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(deadline: string | null, onExpire?: () => void) {
    const target = ref(deadline);
    const scope = effectScope();
    const state = scope.run(() => useCountdown(target, onExpire));
    if (state === undefined) throw new Error('scope did not run');
    return { ...state, target, dispose: () => scope.stop() };
  }

  it('counts down locally, once a second, without asking anybody', async () => {
    const { label, secondsLeft, dispose } = mount('2026-09-06T09:10:00.000Z');

    expect(secondsLeft.value).toBe(600);
    expect(label.value).toBe('10:00');

    await vi.advanceTimersByTimeAsync(65_000);

    expect(secondsLeft.value).toBe(535);
    expect(label.value).toBe('8:55');
    dispose();
  });

  it('asks the server once at zero instead of inventing the next state', async () => {
    const onExpire = vi.fn();
    const { expired, dispose } = mount('2026-09-06T09:00:05.000Z', onExpire);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(expired.value).toBe(true);
    // Nobody is marked missed by a timer. Staff do that, and only the server
    // knows whether they were skipped or walked in.
    expect(onExpire).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('shows nothing at all when there is no deadline', () => {
    const { secondsLeft, label, dispose } = mount(null);

    expect(secondsLeft.value).toBeNull();
    expect(label.value).toBeNull();
    dispose();
  });

  it('starts over when the clinic sets a new deadline', async () => {
    const onExpire = vi.fn();
    const state = mount('2026-09-06T09:00:02.000Z', onExpire);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.expired.value).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);

    // Requeued and called again: a fresh promise, so a fresh countdown.
    state.target.value = '2026-09-06T09:15:00.000Z';
    await vi.advanceTimersByTimeAsync(0);

    expect(state.expired.value).toBe(false);
    // Five seconds have passed since the clock was set, so 09:15 is 895 away.
    expect(state.secondsLeft.value).toBe(895);
    state.dispose();
  });

  it('treats a deadline already past as expired without ticking', () => {
    const onExpire = vi.fn();
    const { expired, secondsLeft, dispose } = mount(
      '2026-09-06T08:50:00.000Z',
      onExpire,
    );

    expect(secondsLeft.value).toBe(0);
    expect(expired.value).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('stops its timer when the screen goes away', async () => {
    const { secondsLeft, dispose } = mount('2026-09-06T09:10:00.000Z');
    const at = secondsLeft.value;

    dispose();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(secondsLeft.value).toBe(at);
  });
});

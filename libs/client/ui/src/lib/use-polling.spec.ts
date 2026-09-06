import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSequence, usePolling } from './use-polling';

/**
 * The lifecycle everything live in the product depends on.
 *
 * Both apps used to own a copy of this, and the copies had already drifted —
 * so these are the properties that must hold for the clinic board and the
 * parent's phone alike.
 */
describe('usePolling', () => {
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(
    tick: () => Promise<void>,
    intervalMs = 5_000,
    onResume?: () => void,
  ) {
    const scope = effectScope();
    const polling = scope.run(() => usePolling(tick, { intervalMs, onResume }));
    if (polling === undefined) throw new Error('scope did not run');
    return { polling, dispose: () => scope.stop() };
  }

  function hide(value: boolean): void {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('ticks on the interval it was given', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick, 5_000);

    polling.start();
    expect(tick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(tick).toHaveBeenCalledTimes(3);

    dispose();
  });

  it('keeps a slower cadence when asked for one', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick, 15_000);
    polling.start();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(tick).toHaveBeenCalledTimes(3);

    dispose();
  });

  it('runs one loop however many times it is started', async () => {
    // A page entered twice — a tab switch, a back-navigation, a re-mount —
    // must never double a clinic's request rate.
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);

    polling.start();
    polling.start();
    polling.start();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('stops asking while the screen is hidden', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);
    polling.start();

    hide(true);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(tick).not.toHaveBeenCalled();
    expect(polling.active.value).toBe(false);

    dispose();
  });

  it('comes back with a full read rather than a stale revision', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const onResume = vi.fn();
    const { polling, dispose } = mount(tick, 5_000, onResume);
    polling.start();

    hide(true);
    await vi.advanceTimersByTimeAsync(600_000);
    hide(false);

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(polling.active.value).toBe(true);

    dispose();
  });

  it('resumes exactly one loop, not a second one', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);
    polling.start();

    hide(true);
    hide(false);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(tick).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('skips a beat rather than stacking requests on a slow link', async () => {
    let release: (() => void) | undefined;
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { polling, dispose } = mount(tick);
    polling.start();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(tick).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('stops on demand, which is what leaving a page does', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);

    polling.start();
    polling.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(tick).not.toHaveBeenCalled();
    dispose();
  });

  it('releases its listener too, so a hidden page cannot wake itself', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const onResume = vi.fn();
    const { polling, dispose } = mount(tick, 5_000, onResume);
    polling.start();

    dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    hide(false);

    expect(tick).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
    expect(polling.active.value).toBe(false);
  });
});

/**
 * The other half of live data: what happens when two answers race.
 */
describe('createSequence', () => {
  it('accepts answers that arrive in order', () => {
    const sequence = createSequence();
    const first = sequence.next();
    const second = sequence.next();

    expect(sequence.accept(first)).toBe(true);
    expect(sequence.accept(second)).toBe(true);
  });

  it('refuses an older answer that arrives after a newer one', () => {
    // A five-second tick goes out, a command's re-read goes out after it and
    // lands first. The tick's answer describes the board as it was before the
    // command, and the screen must not go backwards.
    const sequence = createSequence();
    const poll = sequence.next();
    const command = sequence.next();

    expect(sequence.accept(command)).toBe(true);
    expect(sequence.accept(poll)).toBe(false);
  });

  it('refuses the same answer twice', () => {
    const sequence = createSequence();
    const ticket = sequence.next();

    expect(sequence.accept(ticket)).toBe(true);
    expect(sequence.accept(ticket)).toBe(false);
  });

  it('keeps only the newest of several that land out of order', () => {
    const sequence = createSequence();
    const a = sequence.next();
    const b = sequence.next();
    const c = sequence.next();

    expect(sequence.accept(c)).toBe(true);
    expect(sequence.accept(a)).toBe(false);
    expect(sequence.accept(b)).toBe(false);
  });
});

import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './usePolling';

/**
 * A board is left open on a desk all day, so what this composable does when
 * nobody is looking matters as much as what it does when they are.
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

  /** Run the composable inside a scope a test can dispose deliberately. */
  function mount(
    tick: () => Promise<void>,
    onResume?: () => void,
  ): { polling: ReturnType<typeof usePolling>; dispose: () => void } {
    const scope = effectScope();
    const polling = scope.run(() =>
      usePolling(tick, { intervalMs: 1000, onResume }),
    );
    if (polling === undefined) throw new Error('scope did not run');
    return { polling, dispose: () => scope.stop() };
  }

  function hide(value: boolean): void {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('ticks on the interval, and not before', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);

    polling.start();
    expect(tick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(tick).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('stops while the tab is hidden and does not queue up the missed beats', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);
    polling.start();

    hide(true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(tick).not.toHaveBeenCalled();
    expect(polling.active.value).toBe(false);

    dispose();
  });

  it('comes back with a full read rather than a stale revision', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const onResume = vi.fn();
    const { polling, dispose } = mount(tick, onResume);
    polling.start();

    hide(true);
    await vi.advanceTimersByTimeAsync(10_000);
    hide(false);

    // The whole point: ten minutes later, the revision this board holds is not
    // one the server should be asked about.
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(polling.active.value).toBe(true);

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

    await vi.advanceTimersByTimeAsync(3000);
    // Three beats passed; the first request never came back.
    expect(tick).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('stops when the screen goes away', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);
    polling.start();

    dispose();
    await vi.advanceTimersByTimeAsync(5000);

    expect(tick).not.toHaveBeenCalled();
    expect(polling.active.value).toBe(false);
  });
});

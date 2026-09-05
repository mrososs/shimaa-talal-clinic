import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolling } from './usePolling';

/**
 * A phone in a pocket is the normal state of this app, so what this does when
 * nobody is looking matters more than what it does when they are.
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

  function mount(tick: () => Promise<void>, onResume?: () => void) {
    const scope = effectScope();
    const polling = scope.run(() =>
      usePolling(tick, { intervalMs: 15_000, onResume }),
    );
    if (polling === undefined) throw new Error('scope did not run');
    return { polling, dispose: () => scope.stop() };
  }

  function hide(value: boolean): void {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('ticks on the interval once started', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);

    polling.start();
    expect(tick).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(tick).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('runs one loop however many times it is started', async () => {
    // An Ionic page can be entered twice — a tab switch, a back navigation —
    // and two loops would double every parent's request rate silently.
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);

    polling.start();
    polling.start();
    polling.start();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(tick).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('stops asking while the app is in the background', async () => {
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
    const { polling, dispose } = mount(tick, onResume);
    polling.start();

    hide(true);
    await vi.advanceTimersByTimeAsync(600_000);
    hide(false);

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

    await vi.advanceTimersByTimeAsync(45_000);
    expect(tick).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tick).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('stops when the screen goes away, listener and all', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const onResume = vi.fn();
    const { polling, dispose } = mount(tick, onResume);
    polling.start();

    dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    // A listener left behind would restart a loop for a page nobody is on.
    hide(false);

    expect(tick).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
    expect(polling.active.value).toBe(false);
  });

  it('stops on demand, which is what leaving the page does', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const { polling, dispose } = mount(tick);

    polling.start();
    polling.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(tick).not.toHaveBeenCalled();
    dispose();
  });
});

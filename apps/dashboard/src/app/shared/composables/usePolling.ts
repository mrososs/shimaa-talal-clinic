import { onScopeDispose, ref, type Ref } from 'vue';

export interface Polling {
  /** True while the timer is running and the tab is visible. */
  readonly active: Ref<boolean>;
  start(): void;
  stop(): void;
}

export interface PollingOptions {
  intervalMs: number;
  /**
   * Called when the tab becomes visible again after being hidden.
   *
   * A board that was hidden for ten minutes holds a revision from ten minutes
   * ago. Sending that back would be answered "unchanged" against a board that
   * has moved on, so the page uses this to re-read in full instead.
   */
  onResume?: () => void;
}

/**
 * Run something on a cadence, but only while somebody is looking.
 *
 * A queue board is left open on a desk all day. Polling a hidden tab every five
 * seconds is thousands of requests nobody reads, and on a laptop it is battery
 * spent on a screen that is not there.
 *
 * Ticks never overlap: if one is still in flight when the timer fires, the
 * beat is skipped rather than queued. A slow network would otherwise build a
 * backlog of requests that all land at once, each carrying a revision older
 * than the last.
 */
export function usePolling(
  tick: () => Promise<void>,
  options: PollingOptions,
): Polling {
  const active = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const beat = (): void => {
    if (running) return;
    running = true;
    void tick().finally(() => {
      running = false;
    });
  };

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    active.value = false;
  };

  const start = (): void => {
    if (timer !== null) return;
    active.value = true;
    timer = setInterval(beat, options.intervalMs);
  };

  const onVisibility = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      stop();
      return;
    }
    options.onResume?.();
    start();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  onScopeDispose(() => {
    stop();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  });

  return { active, start, stop };
}

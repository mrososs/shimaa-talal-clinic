import { onScopeDispose, ref, type Ref } from 'vue';

export interface Polling {
  /** True while the timer is running. */
  readonly active: Ref<boolean>;
  start(): void;
  stop(): void;
}

export interface PollingOptions {
  intervalMs: number;
  /**
   * Called when the app comes back to the foreground after being away.
   *
   * A screen that was hidden for ten minutes holds a revision from ten minutes
   * ago. Sending it back would be answered "unchanged" against a queue that has
   * moved on, so the caller uses this to re-read in full instead.
   */
  onResume?: () => void;
}

/**
 * Run something on a cadence, but only while somebody is looking.
 *
 * A phone in a pocket is the normal state of this app. Polling a backgrounded
 * webview every fifteen seconds spends a parent's battery and data on a screen
 * that is not there, so the timer stops the moment the page is hidden and comes
 * back with a fresh read rather than a stale question.
 *
 * Ticks never overlap: if one is still in flight when the timer fires, the beat
 * is skipped rather than queued. On a clinic's wifi a backlog of requests would
 * otherwise land together, each carrying a revision older than the last.
 *
 * `start` is idempotent, which is what stops an Ionic page that is entered
 * twice — a back-navigation, a tab switch — from running two loops against the
 * same state.
 */
export function usePolling(
  tick: () => Promise<void>,
  options: PollingOptions,
): Polling {
  const active = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let listening = false;

  const beat = (): void => {
    if (running) return;
    running = true;
    void tick().finally(() => {
      running = false;
    });
  };

  /**
   * Put the timer down without letting go of the page.
   *
   * Backgrounding is not leaving: the screen is still open and the parent is
   * coming back to it. Dropping the visibility listener here — as an earlier
   * version did — meant the app went quiet and stayed quiet, because nothing
   * was left listening for the return.
   */
  function pause(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    active.value = false;
  }

  const onVisibility = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      pause();
      return;
    }
    options.onResume?.();
    start();
  };

  function stop(): void {
    pause();
    if (listening && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      listening = false;
    }
  }

  function start(): void {
    // Already running. Starting again would leave the first timer orphaned and
    // double the request rate for as long as the screen stays open.
    if (timer !== null) return;
    active.value = true;
    timer = setInterval(beat, options.intervalMs);
    if (!listening && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
      listening = true;
    }
  }

  onScopeDispose(stop);

  return { active, start, stop };
}

import { onScopeDispose, ref, type Ref } from 'vue';

export interface Polling {
  /** True while the timer is running. False while paused or stopped. */
  readonly active: Ref<boolean>;
  /** Begin, or do nothing if already running. */
  start(): void;
  /** End for good: timer cleared, listener released. */
  stop(): void;
}

export interface PollingOptions {
  /** A getter lets a live view slow down while distant and speed up near turn. */
  intervalMs: number | (() => number);
  /**
   * Called when the screen comes back after being hidden.
   *
   * A view that was away for ten minutes holds a revision from ten minutes
   * ago. Sending that back would be answered "unchanged" against a queue that
   * has moved on, so the caller uses this to re-read in full instead.
   */
  onResume?: () => void;
}

/**
 * Run something on a cadence, but only while somebody is looking.
 *
 * Shared because both apps need exactly this and had a copy each — which had
 * already drifted: one released its visibility listener when paused and so
 * never woke up again, the other did not. Two copies of a lifecycle is two
 * places for a subtle bug, and this is the lifecycle everything live in the
 * product depends on.
 *
 * Three properties it guarantees:
 *
 *   1. **One loop.** `start` is idempotent, so a page entered twice — a tab
 *      switch, a back-navigation, a re-mount — never runs two timers against
 *      the same state and never doubles a clinic's request rate.
 *   2. **Nothing while hidden.** A board left open on a desk overnight and a
 *      phone in a pocket both cost nothing, and coming back asks again at once
 *      rather than trusting a stale revision.
 *   3. **No pile-up.** If a tick is still in flight when the timer fires, the
 *      beat is skipped rather than queued. A slow link would otherwise build a
 *      backlog that lands together, each response older than the last.
 *
 * It deliberately does not own *what* is fetched, or how a response is
 * applied — see `createSequence` for the second half of that story.
 */
export function usePolling(
  tick: () => Promise<void>,
  options: PollingOptions,
): Polling {
  const active = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let listening = false;

  const interval = (): number => {
    const value = typeof options.intervalMs === 'function'
      ? options.intervalMs()
      : options.intervalMs;
    return Math.max(1_000, value);
  };

  const schedule = (): void => {
    if (!active.value || timer !== null) return;
    timer = setTimeout(beat, interval());
  };

  const beat = (): void => {
    timer = null;
    if (running) return;
    running = true;
    void tick().finally(() => {
      running = false;
      schedule();
    });
  };

  /**
   * Put the timer down without letting go of the screen.
   *
   * Being hidden is not being closed: the view is still open and whoever left
   * it is coming back. Dropping the visibility listener here would mean going
   * quiet and staying quiet, because nothing would be left listening for the
   * return.
   */
  function pause(): void {
    if (timer !== null) {
      clearTimeout(timer);
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
    // Already running. Starting again would orphan the first timer and double
    // the request rate for as long as the view stays open.
    if (active.value) return;
    active.value = true;
    schedule();
    if (!listening && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
      listening = true;
    }
  }

  onScopeDispose(stop);

  return { active, start, stop };
}

export interface Sequence {
  /** Take a ticket for a request about to be sent. */
  next(): number;
  /**
   * Whether this response may be applied.
   *
   * True only if nothing newer has been applied already; the ticket then
   * becomes the high-water mark.
   */
  accept(ticket: number): boolean;
}

/**
 * Stops an older answer from overwriting a newer one.
 *
 * Polling and acting overlap constantly: a five-second tick goes out, a
 * receptionist presses "Call Next", the command's own re-read comes back with
 * the new board — and then the tick's response arrives, describing the queue as
 * it was before the call. Without this the screen would visibly go backwards
 * for one interval, and the receptionist would press the button again.
 *
 * Ordered by arrival, not by revision. Two responses can carry the same
 * revision — a full board and the "nothing changed" answer to the same
 * revision — so the revision cannot say which of two in-flight requests was
 * asked later. The ticket can.
 */
export function createSequence(): Sequence {
  let issued = 0;
  let applied = 0;

  return {
    next: () => (issued += 1),
    accept: (ticket: number) => {
      if (ticket <= applied) return false;
      applied = ticket;
      return true;
    },
  };
}

import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';

/**
 * Seconds left until a real deadline, ticking locally.
 *
 * The one countdown this app is allowed to run. `graceExpiresAt` is a promise
 * the clinic actually made — "you have ten minutes" — so counting down to it is
 * reporting a fact, not predicting one. An estimated wait is the opposite, and
 * is shown as a band instead.
 *
 * Ticking is local and costs nothing: one timer, no request. Reaching zero does
 * NOT invent the next state — the entry is still `called` until staff say
 * otherwise, and only the server knows whether they were skipped or walked in.
 * `onExpire` exists so the screen can ask, once.
 */
export function useCountdown(
  deadline: Ref<string | null>,
  onExpire?: () => void,
): {
  secondsLeft: Ref<number | null>;
  expired: Ref<boolean>;
  label: Ref<string | null>;
} {
  const secondsLeft = ref<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let fired = false;

  const recompute = (): void => {
    const at = deadline.value;
    if (at === null) {
      secondsLeft.value = null;
      return;
    }
    const left = Math.max(0, Math.round((Date.parse(at) - Date.now()) / 1000));
    secondsLeft.value = left;

    if (left === 0 && !fired) {
      fired = true;
      stop();
      // Ask the server what happened rather than deciding here.
      onExpire?.();
    }
  };

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  watch(
    deadline,
    (at) => {
      stop();
      fired = false;
      recompute();
      if (at !== null && secondsLeft.value !== 0) {
        timer = setInterval(recompute, 1000);
      }
    },
    { immediate: true },
  );

  onScopeDispose(stop);

  const expired = computed(() => secondsLeft.value === 0);

  // mm:ss, and only ever for this deadline.
  const label = computed(() => {
    const left = secondsLeft.value;
    if (left === null) return null;
    const minutes = Math.floor(left / 60);
    const seconds = left % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  });

  return { secondsLeft, expired, label };
}

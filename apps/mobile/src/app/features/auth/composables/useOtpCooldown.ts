import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue';

/** Client-side affordance only; Supabase remains the actual resend authority. */
export function useOtpCooldown(
  issuedAt: number,
  durationSeconds = 60,
): {
  remainingSeconds: Readonly<Ref<number>>;
  canResend: ComputedRef<boolean>;
  restart: (nextIssuedAt?: number) => void;
} {
  const deadline = ref(issuedAt + durationSeconds * 1000);
  const remainingSeconds = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const update = (): void => {
    remainingSeconds.value = Math.max(
      0,
      Math.ceil((deadline.value - Date.now()) / 1000),
    );
    if (remainingSeconds.value === 0) stop();
  };

  const start = (): void => {
    stop();
    update();
    if (remainingSeconds.value > 0) timer = setInterval(update, 1000);
  };

  const restart = (nextIssuedAt = Date.now()): void => {
    deadline.value = nextIssuedAt + durationSeconds * 1000;
    start();
  };

  start();
  onScopeDispose(stop);

  return {
    remainingSeconds,
    canResend: computed(() => remainingSeconds.value === 0),
    restart,
  };
}

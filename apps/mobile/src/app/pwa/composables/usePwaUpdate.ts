import { computed, onScopeDispose, shallowRef } from 'vue';
import { useRegisterSW } from 'virtual:pwa-register/vue';

export const PWA_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function usePwaUpdate() {
  const dismissed = shallowRef(false);
  const updating = shallowRef(false);
  let registration: ServiceWorkerRegistration | undefined;
  let timer: ReturnType<typeof setInterval> | null = null;

  const checkForUpdate = (): void => {
    if (
      registration === undefined ||
      (typeof document !== 'undefined' && document.hidden) ||
      (typeof navigator !== 'undefined' && !navigator.onLine)
    ) {
      return;
    }
    void registration.update();
  };

  const onVisibility = (): void => {
    if (!document.hidden) checkForUpdate();
  };

  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, currentRegistration) {
      registration = currentRegistration;
      if (registration === undefined) return;
      timer = setInterval(checkForUpdate, PWA_UPDATE_INTERVAL_MS);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', checkForUpdate);
    },
  });

  const visible = computed(() => needRefresh.value && !dismissed.value);

  async function update(): Promise<void> {
    if (updating.value) return;
    updating.value = true;
    try {
      await updateServiceWorker(true);
    } finally {
      updating.value = false;
    }
  }

  function dismiss(): void {
    dismissed.value = true;
  }

  onScopeDispose(() => {
    if (timer !== null) clearInterval(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pageshow', checkForUpdate);
    }
  });

  return { visible, updating, dismiss, update };
}


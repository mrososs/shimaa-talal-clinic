import { onMounted, onScopeDispose, readonly, shallowRef } from 'vue';

export function useNetworkStatus() {
  const online = shallowRef(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  const markOnline = (): void => {
    online.value = true;
  };
  const markOffline = (): void => {
    online.value = false;
  };

  onMounted(() => {
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
  });

  onScopeDispose(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('online', markOnline);
    window.removeEventListener('offline', markOffline);
  });

  return { online: readonly(online) };
}


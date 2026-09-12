import { computed, onMounted, onScopeDispose, readonly, shallowRef } from 'vue';

export const INSTALL_DISMISSED_KEY = 'clinic-parent-pwa-install-dismissed';

export type InstallPlatform = 'browser' | 'ios' | null;

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface NavigatorWithStandalone extends Navigator {
  readonly standalone?: boolean;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return (
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as NavigatorWithStandalone).standalone === true
  );
}

export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;

  const agent = navigator.userAgent;
  const iosDevice =
    /iPad|iPhone|iPod/i.test(agent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/i.test(agent);
  const alternativeBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(agent);
  return iosDevice && webkit && !alternativeBrowser;
}

function readDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function usePwaInstall() {
  const promptEvent = shallowRef<BeforeInstallPromptEvent | null>(null);
  const installed = shallowRef(isStandaloneDisplay());
  const dismissed = shallowRef(readDismissed());
  const prompting = shallowRef(false);

  const platform = computed<InstallPlatform>(() => {
    if (installed.value || dismissed.value) return null;
    if (promptEvent.value !== null) return 'browser';
    return isIosSafari() ? 'ios' : null;
  });
  const eligible = computed(() => platform.value !== null);

  const onBeforeInstall = (event: Event): void => {
    event.preventDefault();
    promptEvent.value = event as BeforeInstallPromptEvent;
  };
  const onInstalled = (): void => {
    installed.value = true;
    promptEvent.value = null;
  };

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
  });

  onScopeDispose(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    window.removeEventListener('appinstalled', onInstalled);
  });

  async function install(): Promise<void> {
    const event = promptEvent.value;
    if (event === null || prompting.value) return;

    prompting.value = true;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') installed.value = true;
      promptEvent.value = null;
    } finally {
      prompting.value = false;
    }
  }

  function dismiss(): void {
    dismissed.value = true;
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch {
      // Storage can be unavailable in private modes; hiding it for this mount
      // is still better than blocking the parent with a failing preference.
    }
  }

  return {
    eligible,
    installed: readonly(installed),
    platform,
    prompting: readonly(prompting),
    dismiss,
    install,
  };
}

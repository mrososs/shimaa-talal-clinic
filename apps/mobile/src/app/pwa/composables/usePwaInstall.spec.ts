import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INSTALL_DISMISSED_KEY,
  type BeforeInstallPromptEvent,
  usePwaInstall,
} from './usePwaInstall';

describe('usePwaInstall', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  function mountHost() {
    let state!: ReturnType<typeof usePwaInstall>;
    const Host = defineComponent({
      setup() {
        state = usePwaInstall();
        return () => h('div');
      },
    });
    const wrapper = mount(Host);
    return { state, wrapper };
  }

  it('captures and uses the browser install prompt only after user action', async () => {
    const { state, wrapper } = mountHost();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt', {
      cancelable: true,
    }) as BeforeInstallPromptEvent;
    Object.defineProperties(event, {
      prompt: { value: prompt },
      userChoice: { value: Promise.resolve({ outcome: 'accepted' }) },
    });

    window.dispatchEvent(event);
    await nextTick();
    expect(state.platform.value).toBe('browser');
    expect(prompt).not.toHaveBeenCalled();

    await state.install();
    expect(prompt).toHaveBeenCalledOnce();
    expect(state.installed.value).toBe(true);
    expect(state.eligible.value).toBe(false);
    wrapper.unmount();
  });

  it('persists dismissal for this browser', async () => {
    const { state, wrapper } = mountHost();
    state.dismiss();
    await nextTick();

    expect(state.eligible.value).toBe(false);
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('1');
    wrapper.unmount();
  });

  it('marks the app installed when the browser reports installation', async () => {
    const { state, wrapper } = mountHost();
    window.dispatchEvent(new Event('appinstalled'));
    await nextTick();

    expect(state.installed.value).toBe(true);
    expect(state.eligible.value).toBe(false);
    wrapper.unmount();
  });
});

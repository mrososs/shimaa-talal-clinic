import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNetworkStatus } from './useNetworkStatus';

describe('useNetworkStatus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reflects browser online and offline events', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const Host = defineComponent({
      setup() {
        const { online } = useNetworkStatus();
        return () => h('output', online.value ? 'online' : 'offline');
      },
    });
    const wrapper = mount(Host);

    expect(wrapper.text()).toBe('online');
    window.dispatchEvent(new Event('offline'));
    await nextTick();
    expect(wrapper.text()).toBe('offline');

    window.dispatchEvent(new Event('online'));
    await nextTick();
    expect(wrapper.text()).toBe('online');
    wrapper.unmount();
  });
});

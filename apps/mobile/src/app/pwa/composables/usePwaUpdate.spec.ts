import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sw = vi.hoisted(() => ({
  needRefresh: { value: true },
  updateServiceWorker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => sw,
}));

import { usePwaUpdate } from './usePwaUpdate';

describe('usePwaUpdate', () => {
  afterEach(() => sw.updateServiceWorker.mockClear());

  function mountHost() {
    let state!: ReturnType<typeof usePwaUpdate>;
    const Host = defineComponent({
      setup() {
        state = usePwaUpdate();
        return () => h('div');
      },
    });
    const wrapper = mount(Host);
    return { state, wrapper };
  }

  it('waits for an explicit update action before replacing the worker', async () => {
    const { state, wrapper } = mountHost();
    expect(state.visible.value).toBe(true);
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();

    await state.update();
    expect(sw.updateServiceWorker).toHaveBeenCalledExactlyOnceWith(true);
    wrapper.unmount();
  });

  it('allows postponing the update without activating it', () => {
    const { state, wrapper } = mountHost();
    state.dismiss();

    expect(state.visible.value).toBe(false);
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

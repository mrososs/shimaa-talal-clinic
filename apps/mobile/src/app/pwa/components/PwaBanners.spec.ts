import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import OfflineBanner from './OfflineBanner.vue';
import PwaInstallBanner from './PwaInstallBanner.vue';
import PwaUpdateBanner from './PwaUpdateBanner.vue';

describe('PWA status banners', () => {
  it('shows an Arabic offline warning only while disconnected', async () => {
    const wrapper = mount(OfflineBanner, { props: { visible: false } });
    expect(wrapper.text()).toBe('');

    await wrapper.setProps({ visible: true });
    expect(wrapper.text()).toContain('لا يوجد اتصال بالإنترنت');
  });

  it('offers a real install action for supported browsers', async () => {
    const wrapper = mount(PwaInstallBanner, {
      props: { platform: 'browser', prompting: false },
    });
    await wrapper.get('.install-banner__action').trigger('click');
    expect(wrapper.emitted('install')).toHaveLength(1);
  });

  it('gives iOS Safari manual Add to Home Screen guidance', () => {
    const wrapper = mount(PwaInstallBanner, {
      props: { platform: 'ios', prompting: false },
    });
    expect(wrapper.text()).toContain('إضافة إلى الشاشة الرئيسية');
    expect(wrapper.find('.install-banner__action').exists()).toBe(false);
  });

  it('does not apply a waiting update until the parent chooses update', async () => {
    const wrapper = mount(PwaUpdateBanner, { props: { updating: false } });
    expect(wrapper.emitted('update')).toBeUndefined();

    await wrapper.get('.update-banner__action').trigger('click');
    expect(wrapper.emitted('update')).toHaveLength(1);
  });
});

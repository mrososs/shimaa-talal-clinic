import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NotificationList from './NotificationList.vue';

describe('NotificationList', () => {
  it('emits the selected deep-link notification and marks unread visually', async () => {
    const item = {
      id: 'notification-1',
      kind: 'queue_called' as const,
      title: 'حان دورك الآن',
      body: 'توجهي إلى غرفة الكشف.',
      deepLink: '/tabs/queue',
      readAt: null,
      createdAt: '2026-09-12T10:00:00.000Z',
    };
    const wrapper = mount(NotificationList, {
      props: { items: [item], working: false },
      global: {
        stubs: { IonIcon: { template: '<span />' } },
      },
    });

    expect(wrapper.find('.notification--unread').exists()).toBe(true);
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('open')).toEqual([[item]]);
  });

  it('renders a useful empty state', () => {
    const wrapper = mount(NotificationList, {
      props: { items: [], working: false },
      global: {
        stubs: { IonIcon: { template: '<span />' } },
      },
    });

    expect(wrapper.text()).toContain('لا توجد إشعارات حتى الآن');
  });
});

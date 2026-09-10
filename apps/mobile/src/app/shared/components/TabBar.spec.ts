import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TabBar from './TabBar.vue';

describe('TabBar', () => {
  it('offers the four working top-level destinations as real tab buttons', () => {
    const wrapper = mount(TabBar, {
      global: {
        stubs: {
          IonTabBar: {
            template: '<nav><slot /></nav>',
          },
          IonTabButton: {
            props: ['tab', 'href'],
            template: '<a :data-tab="tab" :href="href"><slot /></a>',
          },
          IonIcon: {
            template: '<span aria-hidden="true" />',
          },
          IonLabel: {
            template: '<span><slot /></span>',
          },
        },
      },
    });

    const tabs = wrapper.findAll('a[data-tab]');

    expect(tabs.map((tab) => tab.attributes('data-tab'))).toEqual([
      'home',
      'appointments',
      'queue',
      'messages',
    ]);
    expect(tabs.map((tab) => tab.attributes('href'))).toEqual([
      '/tabs/home',
      '/tabs/appointments',
      '/tabs/queue',
      '/tabs/messages',
    ]);
    expect(tabs.map((tab) => tab.text())).toEqual([
      'الرئيسية',
      'المواعيد',
      'الطابور',
      'الرسائل',
    ]);
  });
});

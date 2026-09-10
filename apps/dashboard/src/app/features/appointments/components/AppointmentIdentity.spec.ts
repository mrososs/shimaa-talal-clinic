import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AppointmentIdentity from './AppointmentIdentity.vue';

describe('AppointmentIdentity', () => {
  it('shows the patient and the guardian who booked for them', () => {
    const wrapper = mount(AppointmentIdentity, {
      props: {
        child: {
          id: 'child-1',
          fullName: 'لين محمد',
          dateOfBirth: '2023-04-05',
        },
        guardian: {
          id: 'guardian-1',
          fullName: 'سارة أحمد',
          phoneE164: '+201012345678',
        },
      },
    });

    expect(wrapper.text()).toContain('لين محمد');
    expect(wrapper.text()).toContain('ولي الأمر: سارة أحمد');
  });
});

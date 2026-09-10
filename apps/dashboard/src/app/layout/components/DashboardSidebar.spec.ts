import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ClinicMemberRole, ClinicMemberStatus } from '@clinic/contracts';
import DashboardSidebar from './DashboardSidebar.vue';

const RouterLinkStub = {
  props: ['to'],
  template: '<a><slot /></a>',
};

describe('DashboardSidebar', () => {
  it('presents reception as the assistant and emits sign-out', async () => {
    const wrapper = mount(DashboardSidebar, {
      props: {
        member: {
          id: 'member-1',
          clinicId: 'clinic-1',
          role: ClinicMemberRole.Reception,
          displayName: 'مريم',
          status: ClinicMemberStatus.Active,
        },
        clinicName: 'عيادة د. شيماء',
        activeRouteName: 'appointments',
        signingOut: false,
      },
      global: {
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    expect(wrapper.text()).toContain('مريم · المساعدة');
    expect(wrapper.text()).toContain('حجز جديد');
    expect(wrapper.find('.dash-navbtn--active').text()).toContain('المواعيد');

    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('signOut')).toHaveLength(1);
  });

  it('does not offer reception booking to a doctor', () => {
    const wrapper = mount(DashboardSidebar, {
      props: {
        member: {
          id: 'member-2',
          clinicId: 'clinic-1',
          role: ClinicMemberRole.Doctor,
          displayName: 'د. شيماء',
          status: ClinicMemberStatus.Active,
        },
        clinicName: 'عيادة د. شيماء',
        activeRouteName: 'overview',
        signingOut: false,
      },
      global: {
        stubs: { RouterLink: RouterLinkStub },
      },
    });

    expect(wrapper.text()).toContain('د. شيماء · الطبيبة');
    expect(wrapper.text()).not.toContain('حجز جديد');
  });
});

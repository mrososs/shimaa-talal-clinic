import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { StaffFamilyRecord } from '@clinic/contracts';
import FamilyRecordPanel from './FamilyRecordPanel.vue';

const record = {
  guardian: {
    id: 'guardian-1',
    clinicId: 'clinic-1',
    fullName: 'سارة أحمد',
    phoneE164: '+201000000000',
    email: null,
    hasAccount: false,
    createdAt: '2026-09-08T08:00:00.000Z',
  },
  children: [
    {
      id: 'child-1',
      clinicId: 'clinic-1',
      fullName: 'لين',
      dateOfBirth: null,
      sex: null,
      relationship: 'mother',
      isPrimary: true,
    },
  ],
  upcomingVisits: [],
  pastVisits: [],
} as StaffFamilyRecord;

describe('FamilyRecordPanel permissions', () => {
  it('keeps identity and visits readable but hides family mutations from doctors', () => {
    const wrapper = mount(FamilyRecordPanel, {
      props: {
        record,
        loading: false,
        timezone: 'Africa/Cairo',
        canManage: false,
      },
    });

    expect(wrapper.text()).toContain('سارة أحمد');
    expect(wrapper.text()).toContain('لين');
    expect(wrapper.text()).not.toContain('إضافة طفل');
    expect(wrapper.text()).not.toContain('إصدار رمز ربط');
  });

  it('offers explicit family mutations to reception and admin', () => {
    const wrapper = mount(FamilyRecordPanel, {
      props: {
        record,
        loading: false,
        timezone: 'Africa/Cairo',
        canManage: true,
      },
    });

    expect(wrapper.text()).toContain('إضافة طفل');
    expect(wrapper.text()).toContain('إصدار رمز ربط');
  });
});

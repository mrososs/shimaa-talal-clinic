import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ClinicSession } from '@clinic/contracts';
import SessionControls from './SessionControls.vue';

const session = {
  id: 'session-1',
  status: 'open',
  sessionKind: 'morning',
  plannedStart: '2026-09-08T08:00:00.000Z',
  plannedEnd: '2026-09-08T12:00:00.000Z',
  avgConsultMinutes: 8,
  doctorPresence: 'arrived',
  delayMinutes: 0,
} as ClinicSession;

describe('SessionControls permissions', () => {
  it('shows session context but hides desk operations in doctor mode', () => {
    const wrapper = mount(SessionControls, {
      props: {
        session,
        sessions: [session],
        timezone: 'Africa/Cairo',
        working: null,
        operational: false,
      },
    });

    expect(wrapper.text()).toContain('الطابور يعمل');
    expect(wrapper.text()).not.toContain('إيقاف مؤقت');
    expect(wrapper.text()).not.toContain('إنهاء اليوم');
    expect(wrapper.text()).not.toContain('مدة الكشف');
    expect(wrapper.text()).not.toContain('الطبيبة');
  });
});

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ClinicMemberRole, ClinicSessionStatus, DoctorPresence, type MessageThreadDetail, type ClinicSession } from '@clinic/contracts';
import MessageConversation from './MessageConversation.vue';

const thread: MessageThreadDetail = {
  id: 'thread-1',
  guardianId: 'guardian-1',
  childId: 'child-1',
  contactName: 'أم نور',
  childName: 'نور',
  subject: 'حرارة مرتفعة',
  status: 'open',
  priority: 'urgent',
  assignedMemberId: null,
  assignedMemberName: null,
  lastMessagePreview: 'حرارة 39.5',
  lastMessageAt: '2026-09-09T08:00:00.000Z',
  unreadCount: 1,
  urgentCase: {
    id: 'case-1',
    status: 'pending',
    triageNote: 'حرارة مع خمول',
    decisionNote: null,
    createdAt: '2026-09-09T08:00:00.000Z',
    resolvedAt: null,
  },
  messages: [
    {
      id: 'message-1',
      threadId: 'thread-1',
      senderType: 'guardian',
      senderName: 'أم نور',
      body: 'حرارة 39.5',
      createdAt: '2026-09-09T08:00:00.000Z',
    },
  ],
};

const clinicSession: ClinicSession = {
  id: 'session-1',
  clinicId: 'clinic-1',
  doctorMemberId: 'doctor-1',
  sessionDate: '2026-09-09',
  sessionKind: 'morning',
  plannedStart: '2026-09-09T06:00:00.000Z',
  plannedEnd: '2026-09-09T10:00:00.000Z',
  windowMinutes: 60,
  capacityPerWindow: 5,
  status: ClinicSessionStatus.Open,
  doctorPresence: DoctorPresence.Arrived,
  delayMinutes: null,
  delayNote: null,
  avgConsultMinutes: 10,
  revision: 1,
};

describe('MessageConversation', () => {
  it('gives reception escalation controls without a medical decision', () => {
    const wrapper = mount(MessageConversation, {
      props: {
        thread,
        templates: [],
        sessions: [clinicSession],
        role: ClinicMemberRole.Reception,
        working: false,
        loading: false,
      },
    });

    expect(wrapper.text()).toContain('تحويل للطبيبة');
    expect(wrapper.text()).toContain('وجّهي الأسرة للطوارئ فورًا');
    expect(wrapper.text()).not.toContain('قبول وإضافة للطابور');
  });

  it('lets the doctor make the urgent decision and emits replies', async () => {
    const wrapper = mount(MessageConversation, {
      props: {
        thread,
        templates: [],
        sessions: [clinicSession],
        role: ClinicMemberRole.Doctor,
        working: false,
        loading: false,
      },
    });

    expect(wrapper.text()).toContain('قبول وإضافة للطابور كحالة طارئة');
    expect(wrapper.text()).not.toContain('تحويل للطبيبة');

    await wrapper.get('.composer__input').setValue('رد واضح للأسرة');
    await wrapper.get('.composer .dbtn--primary').trigger('click');
    expect(wrapper.emitted('reply')).toEqual([['رد واضح للأسرة']]);
  });
});

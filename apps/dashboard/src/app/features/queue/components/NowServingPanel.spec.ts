import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { QueueBoardEntry } from '@clinic/contracts';
import NowServingPanel from './NowServingPanel.vue';

const entry = (over: Partial<QueueBoardEntry> = {}): QueueBoardEntry =>
  ({
    id: 'entry-1',
    clinicId: 'clinic-1',
    sessionId: 'session-1',
    appointmentId: null,
    childId: 'child-1',
    guardianId: null,
    source: 'walk_in',
    ticketNumber: 1,
    status: 'in_service',
    priority: 100,
    sortKey: '1000',
    visitReason: null,
    checkedInAt: '2026-09-07T08:00:00.000Z',
    calledAt: '2026-09-07T08:01:00.000Z',
    graceExpiresAt: null,
    startedAt: '2026-09-07T08:02:00.000Z',
    completedAt: null,
    deferCount: 0,
    isEmergency: false,
    emergencyReason: null,
    child: {
      id: 'child-1',
      fullName: 'ليان',
      dateOfBirth: null,
      sex: null,
    },
    guardian: null,
    ...over,
  }) as QueueBoardEntry;

const labels = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').map((button) => button.text());

describe('NowServingPanel', () => {
  it('shows two explicit completion actions while a patient is in service', async () => {
    const wrapper = mount(NowServingPanel, {
      global: { stubs: { RouterLink: true } },
      props: {
        inService: entry(),
        called: null,
        waitingCount: 1,
        running: true,
        working: null,
        canMiss: true,
        canComplete: true,
        canRecordMeasurements: true,
      },
    });

    expect(labels(wrapper)).toContain('إنهاء الكشف');
    expect(labels(wrapper)).toContain('تسجيل القياسات');
    expect(labels(wrapper)).toContain('إنهاء واستدعاء التالي');
    expect(labels(wrapper)).not.toContain('استدعاء التالي');

    const buttons = wrapper.findAll('button');
    await buttons
      .find((button) => button.text() === 'إنهاء الكشف')
      ?.trigger('click');
    await buttons
      .find((button) => button.text() === 'إنهاء واستدعاء التالي')
      ?.trigger('click');
    expect(wrapper.emitted('complete')).toEqual([['entry-1']]);
    expect(wrapper.emitted('completeAndCallNext')).toHaveLength(1);
    await buttons
      .find((button) => button.text() === 'تسجيل القياسات')
      ?.trigger('click');
    expect(wrapper.emitted('recordMeasurements')).toEqual([[entry()]]);
  });

  it('keeps complete enabled but disables complete-and-call-next with no waiting patient', () => {
    const wrapper = mount(NowServingPanel, {
      global: { stubs: { RouterLink: true } },
      props: {
        inService: entry(),
        called: null,
        waitingCount: 0,
        running: true,
        working: null,
        canMiss: true,
        canComplete: true,
      },
    });
    const buttons = wrapper.findAll('button');
    expect(
      buttons
        .find((button) => button.text() === 'إنهاء الكشف')
        ?.attributes('disabled'),
    ).toBeUndefined();
    expect(
      buttons
        .find((button) => button.text() === 'إنهاء واستدعاء التالي')
        ?.attributes('disabled'),
    ).toBeDefined();
  });

  it('shows the narrow call-next action only when nobody is in service', () => {
    const wrapper = mount(NowServingPanel, {
      global: { stubs: { RouterLink: true } },
      props: {
        inService: null,
        called: null,
        waitingCount: 1,
        running: true,
        working: null,
        canMiss: true,
        canComplete: true,
      },
    });
    expect(labels(wrapper)).toContain('استدعاء التالي');
    expect(labels(wrapper)).not.toContain('إنهاء الكشف');
  });
});

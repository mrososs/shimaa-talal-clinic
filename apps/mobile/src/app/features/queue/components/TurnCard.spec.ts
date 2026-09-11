import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type {
  ParentQueueItem,
  PaymentRecord,
  QueueStatus,
} from '@clinic/contracts';
import TurnCard from './TurnCard.vue';

const item = (status: QueueStatus = 'waiting') =>
  ({
    childId: 'child-1',
    childName: 'لين',
    appointment: null,
    session: {
      status: 'open',
      doctorPresence: 'arrived',
      delayMinutes: null,
      avgConsultMinutes: 6,
      revision: 4,
    },
    queueEntry: {
      id: 'entry-1',
      ticketNumber: 24,
      status,
      aheadCount: status === 'waiting' ? 3 : 0,
      calledAt: status === 'called' ? '2026-09-11T08:00:00.000Z' : null,
      graceExpiresAt: status === 'called' ? '2026-09-11T08:10:00.000Z' : null,
      estimatedWaitMinutes: status === 'waiting' ? { from: 12, to: 24 } : null,
      deferCount: 0,
      isEmergency: false,
    },
  }) as ParentQueueItem;

describe('TurnCard', () => {
  it('renders the prototype live ring with only the guardian-safe count', () => {
    const wrapper = mount(TurnCard, {
      props: { item: item(), maxSelfDefers: 2 },
      global: {
        stubs: {
          IonIcon: true,
          GraceCountdown: true,
        },
      },
    });

    expect(wrapper.find('.counter__ring').exists()).toBe(true);
    expect(wrapper.text()).toContain('أمامك في الطابور');
    expect(wrapper.text()).toContain('أنت رقم ٢٤');
    expect(wrapper.text()).toContain('١٢–٢٤');
  });

  it('switches to the unmistakable called state', () => {
    const wrapper = mount(TurnCard, {
      props: { item: item('called'), graceMinutes: 10 },
      global: { stubs: { IonIcon: true, GraceCountdown: true } },
    });

    expect(wrapper.text()).toContain('حان دورك الآن!');
    expect(wrapper.find('.counter__ring').exists()).toBe(false);
  });

  it('offers a paid missed visit a credit-preserving reschedule', async () => {
    const missed = item('missed');
    missed.appointment = {
      id: 'appointment-1',
      status: 'no_show',
      windowStart: '2026-09-11T08:00:00.000Z',
      windowEnd: '2026-09-11T08:30:00.000Z',
      visitType: 'new_visit',
    };
    const wrapper = mount(TurnCard, {
      props: {
        item: missed,
        payment: { status: 'paid' } as PaymentRecord,
      },
      global: { stubs: { IonIcon: true, GraceCountdown: true } },
    });

    await wrapper.get('.turn__action').trigger('click');
    expect(wrapper.text()).toContain('دفعك محفوظ');
    expect(wrapper.emitted('reschedule')).toEqual([['appointment-1']]);
  });

  it('does not invent a refund for an unpaid missed visit', async () => {
    const wrapper = mount(TurnCard, {
      props: { item: item('missed') },
      global: { stubs: { IonIcon: true, GraceCountdown: true } },
    });

    await wrapper.get('.turn__action').trigger('click');
    expect(wrapper.text()).toContain('لا يوجد مبلغ للاسترداد');
    expect(wrapper.emitted('rebook')).toHaveLength(1);
  });
});

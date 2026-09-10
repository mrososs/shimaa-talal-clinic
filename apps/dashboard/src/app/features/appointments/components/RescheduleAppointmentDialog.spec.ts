import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppointmentStatus,
  type Appointment,
  type AppointmentListItem,
} from '@clinic/contracts';

vi.mock('../../../runtime', () => ({
  clinicApi: {
    availability: vi.fn(),
    reschedule: vi.fn(),
  },
}));

import { clinicApi } from '../../../runtime';
import RescheduleAppointmentDialog from './RescheduleAppointmentDialog.vue';

const appointment = {
  id: 'appointment-1',
  status: AppointmentStatus.Confirmed,
  child: { id: 'child-1', fullName: 'لين', dateOfBirth: null },
  guardian: { id: 'guardian-1', fullName: 'سارة', phoneE164: '+201000000000' },
} as AppointmentListItem;

const replacement = {
  ...appointment,
  id: 'appointment-2',
  rescheduledFromAppointmentId: 'appointment-1',
} as Appointment;

describe('RescheduleAppointmentDialog', () => {
  beforeEach(() => {
    vi.mocked(clinicApi.availability).mockResolvedValue([
      {
        date: '2026-09-09',
        windows: [
          {
            sessionId: 'session-2',
            sessionKind: 'morning',
            windowStart: '2026-09-09T08:00:00.000Z',
            windowEnd: '2026-09-09T09:00:00.000Z',
            capacity: 5,
            taken: 2,
            remaining: 3,
          },
        ],
      },
    ]);
    vi.mocked(clinicApi.reschedule).mockResolvedValue(replacement);
  });

  it('loads live capacity and emits the replacement appointment', async () => {
    const wrapper = mount(RescheduleAppointmentDialog, {
      props: {
        open: true,
        appointment,
        timezone: 'Africa/Cairo',
        today: '2026-09-08',
      },
      global: {
        stubs: {
          ClinicDialog: {
            props: ['open'],
            template:
              '<div v-if="open"><slot /><slot name="actions" /></div>',
          },
        },
      },
    });
    await flushPromises();

    expect(clinicApi.availability).toHaveBeenCalledWith({
      date: '2026-09-08',
      to: '2026-09-14',
    });
    await wrapper.get('.reschedule__window').trigger('click');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('تأكيد'))
      ?.trigger('click');
    await flushPromises();

    expect(clinicApi.reschedule).toHaveBeenCalledWith('appointment-1', {
      sessionId: 'session-2',
      windowStart: '2026-09-09T08:00:00.000Z',
    });
    expect(wrapper.emitted('rescheduled')).toEqual([[replacement]]);
  });
});

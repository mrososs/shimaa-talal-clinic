import { AppointmentStatus, type Appointment } from '@clinic/contracts';
import type { AppointmentService } from '@clinic/server-booking';
import { BookingError } from '@clinic/server-booking';
import type { ClinicService } from '@clinic/server-clinic';
import type { DatabaseService, SqlExecutor } from '@clinic/server-core';
import type {
  QueueCommandService,
  QueueEntryService,
} from '@clinic/server-queue';
import { CheckInAppointmentWorkflow } from './check-in-appointment.workflow';

/**
 * Arriving early and where an early arrival stands are separate questions.
 *
 * The boundary was once evaluated only when fairness placement was switched on,
 * so a clinic running without fairness — which is the pilot's configuration —
 * accepted a check-in at any hour of the day. These lock the two apart.
 */

const WINDOW_START = '2026-09-13T12:00:00.000Z'; // 15:00 in Africa/Cairo
const WINDOW_END = '2026-09-13T13:00:00.000Z';

const APPOINTMENT: Appointment = {
  id: 'appointment-1',
  clinicId: 'clinic-1',
  sessionId: 'session-1',
  childId: 'child-1',
  guardianId: 'guardian-1',
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  visitType: 'new_visit',
  status: AppointmentStatus.Confirmed,
  notes: null,
  createdByMemberId: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  rescheduledFromAppointmentId: null,
  createdAt: '2026-09-12T08:00:00.000Z',
  attendanceIntent: 'unknown',
  attendanceIntentSetAt: null,
};

interface Harness {
  workflow: CheckInAppointmentWorkflow;
  admit: jest.Mock;
  transition: jest.Mock;
}

function harness(options: {
  fairnessEnabled: boolean;
  earlyCheckInMinutes?: number;
  estimatorEnabled?: boolean;
  publishedRecommendedArrival?: Date | null;
}): Harness {
  const tx = {
    query: jest.fn().mockResolvedValue({
      rows: options.publishedRecommendedArrival
        ? [{ published_recommended_arrival: options.publishedRecommendedArrival }]
        : [],
    }),
  } as unknown as SqlExecutor;

  const database = {
    transaction: (run: (tx: SqlExecutor) => Promise<unknown>) => run(tx),
  } as unknown as DatabaseService;

  const admit = jest.fn().mockResolvedValue({
    id: 'entry-1',
    ticketNumber: 1,
    appointmentId: APPOINTMENT.id,
  });
  const transition = jest.fn().mockResolvedValue(APPOINTMENT);

  const workflow = new CheckInAppointmentWorkflow(
    database,
    {
      findForCheckIn: jest.fn().mockResolvedValue(APPOINTMENT),
      transition,
    } as unknown as AppointmentService,
    { admit } as unknown as QueueCommandService,
    {
      findByAppointment: jest.fn().mockResolvedValue(null),
    } as unknown as QueueEntryService,
    {
      findTrackingPolicy: jest.fn().mockResolvedValue({
        fairnessEnabled: options.fairnessEnabled,
        estimatorEnabled: options.estimatorEnabled ?? false,
        earlyCheckInMinutes: options.earlyCheckInMinutes ?? 30,
      }),
    } as unknown as ClinicService,
  );

  return { workflow, admit, transition };
}

const check = (
  workflow: CheckInAppointmentWorkflow,
  over: { forceEarly?: boolean; earlyReason?: string | null } = {},
) =>
  workflow.execute({
    clinicId: 'clinic-1',
    appointmentId: APPOINTMENT.id,
    memberId: 'member-1',
    ...over,
  });

/** 10:27 Cairo — four and a half hours before a 15:00 window. */
function farTooEarly(): void {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-13T07:27:00Z'));
}

/** 14:45 Cairo — inside the configured thirty-minute grace. */
function insideGrace(): void {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-13T11:45:00Z'));
}

describe('CheckInAppointmentWorkflow early arrival', () => {
  afterEach(() => jest.restoreAllMocks());

  describe.each([
    ['fairness off', false],
    ['fairness on', true],
  ])('with %s', (_label, fairnessEnabled) => {
    it('refuses a patient who arrives before the boundary', async () => {
      farTooEarly();
      const { workflow, admit, transition } = harness({ fairnessEnabled });

      await expect(check(workflow)).rejects.toBeInstanceOf(BookingError);
      // Nothing was written: no ticket, and the booking never moved.
      expect(admit).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    });

    it('reports when the patient may come in', async () => {
      farTooEarly();
      const { workflow } = harness({ fairnessEnabled });

      const error = await check(workflow).catch((e: BookingError) => e);

      expect((error as BookingError).details).toEqual({
        // 15:00 window, thirty minutes' grace.
        earliestAllowedAt: '2026-09-13T11:30:00.000Z',
      });
    });

    it('admits a patient inside the allowed window', async () => {
      insideGrace();
      const { workflow, admit, transition } = harness({ fairnessEnabled });

      await expect(check(workflow)).resolves.toMatchObject({ ticketNumber: 1 });
      expect(admit).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalledWith(
        'clinic-1',
        APPOINTMENT.id,
        AppointmentStatus.CheckedIn,
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('staff override', () => {
    it('refuses an override with no reason', async () => {
      farTooEarly();
      const { workflow, admit } = harness({ fairnessEnabled: false });

      await expect(
        check(workflow, { forceEarly: true, earlyReason: '   ' }),
      ).rejects.toThrow(/reason/i);
      expect(admit).not.toHaveBeenCalled();
    });

    it('admits an early arrival when a reason is given, and records it', async () => {
      farTooEarly();
      const { workflow, admit } = harness({ fairnessEnabled: false });

      await expect(
        check(workflow, { forceEarly: true, earlyReason: 'الأم لديها ظرف طارئ' }),
      ).resolves.toMatchObject({ ticketNumber: 1 });

      expect(admit).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: 'الأم لديها ظرف طارئ' }),
        expect.anything(),
      );
    });

    it('buys arrival order, never priority', async () => {
      farTooEarly();
      const { workflow, admit } = harness({ fairnessEnabled: true });

      await check(workflow, { forceEarly: true, earlyReason: 'ظرف طارئ' });

      const [admitted] = admit.mock.calls[0] as [
        { serviceEligibleAt: string | null; fairnessAnchorAt: string },
      ];
      // Held until the moment they would ordinarily have been let in, and
      // anchored to their own window rather than to the head of the line.
      expect(admitted.serviceEligibleAt).toBe('2026-09-13T11:30:00.000Z');
      expect(admitted.fairnessAnchorAt).toBe(WINDOW_START);
    });
  });

  describe('published recommendation', () => {
    it('is consulted only when the estimator is running', async () => {
      // 13:00 Cairo: inside the window's own grace, but before the grace on a
      // recommendation of 16:00.
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse('2026-09-13T11:35:00Z'));

      const gated = harness({
        fairnessEnabled: false,
        estimatorEnabled: false,
        publishedRecommendedArrival: new Date('2026-09-13T13:00:00.000Z'),
      });
      await expect(check(gated.workflow)).resolves.toMatchObject({
        ticketNumber: 1,
      });

      const running = harness({
        fairnessEnabled: false,
        estimatorEnabled: true,
        publishedRecommendedArrival: new Date('2026-09-13T13:00:00.000Z'),
      });
      await expect(check(running.workflow)).rejects.toBeInstanceOf(BookingError);
    });
  });
});

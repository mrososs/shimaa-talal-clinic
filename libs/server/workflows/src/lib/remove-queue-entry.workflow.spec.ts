import {
  AppointmentStatus,
  QueueStatus,
  type Appointment,
  type QueueEntry,
} from '@clinic/contracts';
import type { AppointmentService } from '@clinic/server-booking';
import type { DatabaseService, SqlExecutor } from '@clinic/server-core';
import type { QueueCommandService } from '@clinic/server-queue';
import { RemoveQueueEntryWorkflow } from './remove-queue-entry.workflow';

/**
 * Removing a patient used to cancel the queue entry alone, leaving the booking
 * at `checked_in`: a visit the clinic believed was under way for somebody who
 * had gone home. These hold the two halves together.
 */

const APPOINTMENT: Appointment = {
  id: 'appointment-1',
  clinicId: 'clinic-1',
  sessionId: 'session-1',
  childId: 'child-1',
  guardianId: 'guardian-1',
  windowStart: '2026-09-13T08:00:00.000Z',
  windowEnd: '2026-09-13T09:00:00.000Z',
  visitType: 'new_visit',
  status: AppointmentStatus.CheckedIn,
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

const entry = (over: Partial<QueueEntry> = {}): QueueEntry =>
  ({
    id: 'entry-1',
    clinicId: 'clinic-1',
    sessionId: 'session-1',
    appointmentId: 'appointment-1',
    childId: 'child-1',
    status: QueueStatus.Cancelled,
    ticketNumber: 4,
    ...over,
  }) as QueueEntry;

function harness(options: {
  cancel?: jest.Mock;
  appointment?: Appointment | null;
}) {
  const tx = { query: jest.fn() } as unknown as SqlExecutor;
  const database = {
    transaction: (run: (tx: SqlExecutor) => Promise<unknown>) => run(tx),
  } as unknown as DatabaseService;

  const cancel = options.cancel ?? jest.fn().mockResolvedValue(entry());
  const transition = jest.fn().mockResolvedValue(APPOINTMENT);
  const findById = jest
    .fn()
    .mockResolvedValue(
      options.appointment === undefined ? APPOINTMENT : options.appointment,
    );

  const workflow = new RemoveQueueEntryWorkflow(
    database,
    { cancel } as unknown as QueueCommandService,
    { findById, transition } as unknown as AppointmentService,
  );

  return { workflow, cancel, transition, findById };
}

const remove = (workflow: RemoveQueueEntryWorkflow) =>
  workflow.execute({
    clinicId: 'clinic-1',
    entryId: 'entry-1',
    memberId: 'member-1',
    reason: 'غادرت الأسرة قبل الكشف',
  });

describe('RemoveQueueEntryWorkflow', () => {
  afterEach(() => jest.restoreAllMocks());

  it('cancels the booking of a patient who had checked in', async () => {
    const { workflow, transition } = harness({});

    await expect(remove(workflow)).resolves.toMatchObject({
      status: QueueStatus.Cancelled,
    });

    // Cancelled, never no_show: they did arrive, and saying otherwise would be
    // a false statement about a family who came.
    expect(transition).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      AppointmentStatus.Cancelled,
      expect.objectContaining({
        memberId: 'member-1',
        reason: 'غادرت الأسرة قبل الكشف',
      }),
      expect.anything(),
    );
  });

  it('leaves a walk-in alone — there is no booking to cancel', async () => {
    const { workflow, transition, findById } = harness({
      cancel: jest.fn().mockResolvedValue(entry({ appointmentId: null })),
    });

    await expect(remove(workflow)).resolves.toMatchObject({
      appointmentId: null,
    });
    expect(findById).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('does not re-terminate a booking that is already settled', async () => {
    // A missed entry's appointment is already `no_show`, which is terminal.
    const { workflow, transition } = harness({
      appointment: { ...APPOINTMENT, status: AppointmentStatus.NoShow },
    });

    await expect(remove(workflow)).resolves.toBeDefined();
    expect(transition).not.toHaveBeenCalled();
  });

  it('refuses when Queue refuses, and never touches the booking', async () => {
    // Queue allows cancelling only from waiting, called or missed, so a patient
    // in the room or already finished is stopped before Booking is reached.
    const { workflow, transition } = harness({
      cancel: jest.fn().mockRejectedValue(new Error('queue_invalid_transition')),
    });

    await expect(remove(workflow)).rejects.toThrow(/queue_invalid_transition/);
    expect(transition).not.toHaveBeenCalled();
  });

  it('runs both writes inside the caller transaction when given one', async () => {
    const { workflow, cancel, transition } = harness({});
    const outer = { query: jest.fn() } as unknown as SqlExecutor;

    await workflow.execute(
      {
        clinicId: 'clinic-1',
        entryId: 'entry-1',
        memberId: 'member-1',
        reason: null,
      },
      outer,
    );

    // The same executor reaches both domains, so one failure rolls back both.
    expect(cancel.mock.calls[0][3]).toBe(outer);
    expect(transition.mock.calls[0][4]).toBe(outer);
  });
});

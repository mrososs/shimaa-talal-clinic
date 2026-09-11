import { AppointmentStatus, QueueStatus } from '@clinic/contracts';
import { MissQueueEntryWorkflow } from './miss-queue-entry.workflow';
import { RequeueEntryWorkflow } from './requeue-entry.workflow';

describe('miss/requeue cross-domain workflows', () => {
  const tx = { query: jest.fn() };
  const database = {
    transaction: jest.fn((work: (executor: unknown) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const missed = {
    id: 'entry-1',
    appointmentId: 'appointment-1',
    status: QueueStatus.Missed,
  };
  const waiting = { ...missed, status: QueueStatus.Waiting };

  beforeEach(() => jest.clearAllMocks());

  it('misses queue, appointment and pending cash on the same executor', async () => {
    const queue = { miss: jest.fn().mockResolvedValue(missed) };
    const appointments = {
      transition: jest
        .fn()
        .mockResolvedValue({ status: AppointmentStatus.NoShow }),
    };
    const payments = { voidPendingCashForNoShow: jest.fn() };
    const workflow = new MissQueueEntryWorkflow(
      database as never,
      queue as never,
      appointments as never,
      payments as never,
    );

    await workflow.execute({
      clinicId: 'clinic-1',
      entryId: 'entry-1',
      memberId: 'member-1',
      force: true,
      reason: 'اتصلنا بالأسرة',
    });

    expect(queue.miss.mock.calls[0]).toContain(tx);
    expect(appointments.transition).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      AppointmentStatus.NoShow,
      { memberId: 'member-1', reason: 'اتصلنا بالأسرة' },
      tx,
    );
    expect(payments.voidPendingCashForNoShow.mock.calls[0]).toContain(tx);
  });

  it('restores queue, appointment and cash promise on the same executor', async () => {
    const queue = { requeue: jest.fn().mockResolvedValue(waiting) };
    const appointments = { restoreNoShowCheckIn: jest.fn() };
    const payments = { restoreCashAfterRequeue: jest.fn() };
    const workflow = new RequeueEntryWorkflow(
      database as never,
      queue as never,
      appointments as never,
      payments as never,
    );

    await workflow.execute({
      clinicId: 'clinic-1',
      entryId: 'entry-1',
      memberId: 'member-1',
    });

    expect(queue.requeue.mock.calls[0]).toContain(tx);
    expect(appointments.restoreNoShowCheckIn).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      { memberId: 'member-1' },
      tx,
    );
    expect(payments.restoreCashAfterRequeue.mock.calls[0]).toContain(tx);
  });
});

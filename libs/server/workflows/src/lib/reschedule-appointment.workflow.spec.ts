import { AppointmentStatus, PaymentStatus } from '@clinic/contracts';
import { PaymentsErrorCode } from '@clinic/server-payments';
import { RescheduleAppointmentWorkflow } from './reschedule-appointment.workflow';

describe('RescheduleAppointmentWorkflow', () => {
  const original = {
    id: 'appointment-1',
    clinicId: 'clinic-1',
    guardianId: 'guardian-1',
    status: AppointmentStatus.Confirmed,
  };
  const replacement = { ...original, id: 'appointment-2' };
  const input = {
    clinicId: 'clinic-1',
    appointmentId: original.id,
    target: {
      sessionId: 'session-2',
      windowStart: '2026-09-18T10:00:00.000Z',
    },
    actor: { guardianId: 'guardian-1', authUserId: 'auth-1' },
  };

  function setup() {
    const tx = { query: jest.fn() };
    const database = {
      transaction: jest.fn((work: (executor: unknown) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const appointments = {
      findByIdForUpdate: jest.fn().mockResolvedValue(original),
      findLiveRescheduledFrom: jest.fn().mockResolvedValue(null),
      reschedule: jest.fn().mockResolvedValue(replacement),
    };
    const payments = {
      findActiveForTransfer: jest.fn().mockResolvedValue(null),
      transferToAppointment: jest.fn(),
    };
    const workflow = new RescheduleAppointmentWorkflow(
      database as never,
      appointments as never,
      payments as never,
    );
    return { workflow, database, appointments, payments, tx };
  }

  it('moves an active payment to the replacement in the same transaction', async () => {
    const { workflow, database, appointments, payments, tx } = setup();
    const payment = {
      id: 'payment-1',
      status: PaymentStatus.Paid,
    };
    payments.findActiveForTransfer.mockResolvedValue(payment);

    await expect(workflow.execute(input)).resolves.toEqual({
      ...replacement,
      trackingLinkRotation: null,
    });

    expect(appointments.reschedule).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      input.target,
      { authUserId: 'auth-1' },
      tx,
    );
    expect(payments.transferToAppointment).toHaveBeenCalledWith(
      'clinic-1',
      payment,
      'appointment-1',
      'appointment-2',
      { guardianId: 'guardian-1' },
      tx,
    );
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an unpaid no-show before claiming a new seat', async () => {
    const { workflow, appointments, payments } = setup();
    appointments.findByIdForUpdate.mockResolvedValue({
      ...original,
      status: AppointmentStatus.NoShow,
    });

    await expect(workflow.execute(input)).rejects.toMatchObject({
      code: PaymentsErrorCode.MissedRescheduleRequiresPaid,
    });
    expect(appointments.reschedule).not.toHaveBeenCalled();
    expect(payments.transferToAppointment).not.toHaveBeenCalled();
  });

  it('returns the existing replacement on a safe retry', async () => {
    const { workflow, appointments, payments } = setup();
    appointments.findLiveRescheduledFrom.mockResolvedValue(replacement);

    await expect(workflow.execute(input)).resolves.toEqual({
      ...replacement,
      trackingLinkRotation: null,
    });
    expect(payments.findActiveForTransfer).not.toHaveBeenCalled();
    expect(appointments.reschedule).not.toHaveBeenCalled();
  });
});

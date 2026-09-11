import { AppointmentStatus } from '@clinic/contracts';
import { NoShowAppointmentWorkflow } from './no-show-appointment.workflow';

describe('NoShowAppointmentWorkflow', () => {
  it('marks Booking absent and voids uncollected cash on one executor', async () => {
    const tx = { query: jest.fn() };
    const database = {
      transaction: jest.fn((work: (executor: unknown) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const noShow = { id: 'appointment-1', status: AppointmentStatus.NoShow };
    const appointments = { transition: jest.fn().mockResolvedValue(noShow) };
    const payments = {
      voidPendingCashForNoShow: jest.fn().mockResolvedValue(null),
    };
    const workflow = new NoShowAppointmentWorkflow(
      database as never,
      appointments as never,
      payments as never,
    );

    await expect(
      workflow.execute({
        clinicId: 'clinic-1',
        appointmentId: 'appointment-1',
        memberId: 'member-1',
      }),
    ).resolves.toBe(noShow);
    expect(appointments.transition).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      AppointmentStatus.NoShow,
      { memberId: 'member-1' },
      tx,
    );
    expect(payments.voidPendingCashForNoShow).toHaveBeenCalledWith(
      'clinic-1',
      'appointment-1',
      'member-1',
      tx,
    );
  });
});

import { AppointmentStatus, type Appointment } from '@clinic/contracts';
import type { AppointmentService } from '@clinic/server-booking';
import type { PatientDirectoryService } from '@clinic/server-patients';
import { StaffAppointmentsWorkflow } from './staff-appointments.workflow';

const APPOINTMENT: Appointment = {
  id: 'appointment-1',
  clinicId: 'clinic-1',
  sessionId: 'session-1',
  childId: 'child-1',
  guardianId: 'guardian-1',
  windowStart: '2026-09-08T08:00:00.000Z',
  windowEnd: '2026-09-08T09:00:00.000Z',
  visitType: 'new_visit',
  status: AppointmentStatus.Requested,
  notes: null,
  createdByMemberId: null,
  cancelledAt: null,
  cancelledBy: null,
  cancellationReason: null,
  rescheduledFromAppointmentId: null,
  createdAt: '2026-09-07T08:00:00.000Z',
  attendanceIntent: 'unknown',
  attendanceIntentSetAt: null,
};

describe('StaffAppointmentsWorkflow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enriches the Booking day with child and guardian identity', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-08T10:00:00Z'));

    const appointments = {
      listForDay: jest.fn().mockResolvedValue([APPOINTMENT]),
    };
    const directory = {
      childSummaries: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              'child-1',
              { id: 'child-1', fullName: 'لين', dateOfBirth: '2023-04-05' },
            ],
          ]),
        ),
      guardianSummaries: jest.fn().mockResolvedValue(
        new Map([
          [
            'guardian-1',
            {
              id: 'guardian-1',
              fullName: 'سارة أحمد',
              phoneE164: '+201012345678',
            },
          ],
        ]),
      ),
    };

    const workflow = new StaffAppointmentsWorkflow(
      appointments as unknown as AppointmentService,
      directory as unknown as PatientDirectoryService,
    );

    await expect(
      workflow.execute({ clinicId: 'clinic-1', date: '2026-09-08' }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'appointment-1',
        child: {
          id: 'child-1',
          fullName: 'لين',
          dateOfBirth: '2023-04-05',
        },
        guardian: {
          id: 'guardian-1',
          fullName: 'سارة أحمد',
          phoneE164: '+201012345678',
        },
        isLate: true,
      }),
    ]);
    expect(appointments.listForDay).toHaveBeenCalledWith(
      'clinic-1',
      '2026-09-08',
      undefined,
    );
  });

  it('does not label an arrived appointment late', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-08T10:00:00Z'));
    const appointments = {
      listForDay: jest
        .fn()
        .mockResolvedValue([
          { ...APPOINTMENT, status: AppointmentStatus.CheckedIn },
        ]),
    };
    const directory = {
      childSummaries: jest.fn().mockResolvedValue(new Map()),
      guardianSummaries: jest.fn().mockResolvedValue(new Map()),
    };
    const workflow = new StaffAppointmentsWorkflow(
      appointments as unknown as AppointmentService,
      directory as unknown as PatientDirectoryService,
    );

    const [result] = await workflow.execute({
      clinicId: 'clinic-1',
      date: '2026-09-08',
    });

    expect(result.isLate).toBe(false);
    expect(result.child.fullName).toBe('—');
    expect(result.guardian.fullName).toBe('—');
  });

  it('uses the bounded range read for week and month views', async () => {
    const appointments = {
      listForRange: jest.fn().mockResolvedValue([]),
    };
    const directory = {
      childSummaries: jest.fn().mockResolvedValue(new Map()),
      guardianSummaries: jest.fn().mockResolvedValue(new Map()),
    };
    const workflow = new StaffAppointmentsWorkflow(
      appointments as unknown as AppointmentService,
      directory as unknown as PatientDirectoryService,
    );

    await workflow.execute({
      clinicId: 'clinic-1',
      date: '2026-09-01',
      to: '2026-09-30',
    });

    expect(appointments.listForRange).toHaveBeenCalledWith(
      'clinic-1',
      '2026-09-01',
      '2026-09-30',
      undefined,
    );
  });
});

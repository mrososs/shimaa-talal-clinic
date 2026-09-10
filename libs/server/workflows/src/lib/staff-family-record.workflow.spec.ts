import { PatientsErrorCode } from '@clinic/server-patients';
import { StaffFamilyRecordWorkflow } from './staff-family-record.workflow';

describe('StaffFamilyRecordWorkflow', () => {
  const guardian = {
    id: 'guardian-1',
    clinicId: 'clinic-1',
    fullName: 'سارة أحمد',
  };
  const children = [{ id: 'child-1', fullName: 'لين' }];
  const appointment = {
    id: 'appointment-1',
    childId: 'child-1',
    windowStart: '2026-09-08T08:00:00.000Z',
    windowEnd: '2026-09-08T08:30:00.000Z',
    visitType: 'follow_up',
    status: 'completed',
    notes: 'must not cross the response boundary',
  };

  it('composes tenant-scoped identity and note-free visit history', async () => {
    const guardians = { findById: jest.fn().mockResolvedValue(guardian) };
    const childService = { listForGuardian: jest.fn().mockResolvedValue(children) };
    const appointments = {
      listForGuardian: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([appointment]),
    };
    const workflow = new StaffFamilyRecordWorkflow(
      guardians as never,
      childService as never,
      appointments as never,
    );

    const result = await workflow.execute({ clinicId: 'clinic-1', guardianId: 'guardian-1' });

    expect(guardians.findById).toHaveBeenCalledWith('clinic-1', 'guardian-1', undefined);
    expect(result.pastVisits[0]).not.toHaveProperty('notes');
    expect(result.pastVisits[0]).toMatchObject({ id: 'appointment-1', childId: 'child-1' });
  });

  it('does not query Booking when the guardian is outside the clinic', async () => {
    const appointments = { listForGuardian: jest.fn() };
    const workflow = new StaffFamilyRecordWorkflow(
      { findById: jest.fn().mockResolvedValue(null) } as never,
      { listForGuardian: jest.fn() } as never,
      appointments as never,
    );

    await expect(
      workflow.execute({ clinicId: 'clinic-1', guardianId: 'foreign' }),
    ).rejects.toMatchObject({ code: PatientsErrorCode.GuardianNotFound });
    expect(appointments.listForGuardian).not.toHaveBeenCalled();
  });
});

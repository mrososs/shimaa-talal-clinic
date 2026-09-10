import type {
  ClinicalMeasurement,
  Child,
} from '@clinic/contracts';
import type { AppointmentService } from '@clinic/server-booking';
import type { ClinicalService } from '@clinic/server-clinical';
import type { DatabaseService } from '@clinic/server-core';
import {
  PatientsError,
  PatientsErrorCode,
  type ChildService,
  type GuardianOwnershipService,
} from '@clinic/server-patients';
import type { QueueEntryService } from '@clinic/server-queue';
import type { CompleteQueueEntryWorkflow } from './complete-queue-entry.workflow';
import { ClinicalWorkflow } from './clinical.workflow';

describe('ClinicalWorkflow parent growth', () => {
  const child: Child = {
    id: 'child-1',
    clinicId: 'clinic-1',
    fullName: 'لين أحمد',
    dateOfBirth: '2022-04-12',
    sex: 'female',
  };
  const measurement: ClinicalMeasurement = {
    id: 'measurement-1',
    childId: child.id,
    appointmentId: 'appointment-private',
    weightKg: 14.2,
    heightCm: 96,
    headCircumferenceCm: 49,
    temperatureC: 38.1,
    measuredAt: '2026-09-10T10:00:00.000Z',
  };

  function setup(options: { allowed?: boolean } = {}) {
    const ownership = {
      assertCanAccessChild: jest.fn().mockImplementation(async () => {
        if (options.allowed === false) {
          throw new PatientsError(
            PatientsErrorCode.ChildNotFound,
            'No such child at this clinic.',
          );
        }
      }),
    };
    const children = { findById: jest.fn().mockResolvedValue(child) };
    const clinical = {
      listMeasurements: jest.fn().mockResolvedValue([measurement]),
    };
    const workflow = new ClinicalWorkflow(
      {} as DatabaseService,
      {} as AppointmentService,
      children as unknown as ChildService,
      ownership as unknown as GuardianOwnershipService,
      {} as QueueEntryService,
      clinical as unknown as ClinicalService,
      {} as CompleteQueueEntryWorkflow,
    );
    return { workflow, ownership, children, clinical };
  }

  it('returns only guardian-safe growth fields for an owned child', async () => {
    const { workflow, ownership } = setup();

    const result = await workflow.parentGrowth(
      'clinic-1',
      'guardian-1',
      'child-1',
    );

    expect(ownership.assertCanAccessChild).toHaveBeenCalledWith(
      'clinic-1',
      'guardian-1',
      'child-1',
    );
    expect(result).toEqual({
      child: {
        id: child.id,
        fullName: child.fullName,
        dateOfBirth: child.dateOfBirth,
        sex: child.sex,
      },
      measurements: [
        {
          id: measurement.id,
          weightKg: 14.2,
          heightCm: 96,
          headCircumferenceCm: 49,
          measuredAt: measurement.measuredAt,
        },
      ],
    });
    expect(result.measurements[0]).not.toHaveProperty('temperatureC');
    expect(result.measurements[0]).not.toHaveProperty('appointmentId');
  });

  it('rejects another family before reading any measurement', async () => {
    const { workflow, children, clinical } = setup({ allowed: false });

    await expect(
      workflow.parentGrowth('clinic-1', 'guardian-2', 'child-1'),
    ).rejects.toMatchObject({ code: PatientsErrorCode.ChildNotFound });
    expect(children.findById).not.toHaveBeenCalled();
    expect(clinical.listMeasurements).not.toHaveBeenCalled();
  });
});

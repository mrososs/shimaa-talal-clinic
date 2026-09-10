import { describe, expect, it, vi } from 'vitest';
import type { ClinicApi } from '../../clinic/clinic.api';
import { useClinicalEncounter } from './useClinicalEncounter';

const encounter = {
  id: 'encounter-1',
  appointmentId: 'appointment-1',
  childId: 'child-1',
  status: 'draft',
  diagnosis: 'نزلة برد',
  investigations: '',
  treatmentInstructions: 'سوائل',
  growthObservation: '',
  followUpDays: 7,
  parentSummary: 'متابعة بعد أسبوع',
  revision: 1,
  updatedAt: '2026-09-09T10:00:00.000Z',
  finalizedAt: null,
} as const;

describe('useClinicalEncounter', () => {
  it('loads the draft and replaces the record after save and finalize', async () => {
    const api = {
      clinicalRecord: vi.fn().mockResolvedValue({
        encounter,
        measurements: [],
        previousEncounters: [],
      }),
      saveClinicalDraft: vi
        .fn()
        .mockResolvedValue({ ...encounter, diagnosis: 'متابعة' }),
      finalizeClinicalEncounter: vi.fn().mockResolvedValue({
        ...encounter,
        status: 'final',
        revision: 2,
        finalizedAt: '2026-09-09T10:05:00.000Z',
      }),
    } as unknown as ClinicApi;
    const clinical = useClinicalEncounter(api);

    await clinical.load('appointment-1');
    expect(clinical.form.diagnosis).toBe('نزلة برد');

    clinical.form.diagnosis = 'متابعة';
    await expect(clinical.save('appointment-1')).resolves.toBe(true);
    expect(api.saveClinicalDraft).toHaveBeenCalledWith(
      'appointment-1',
      expect.objectContaining({ diagnosis: 'متابعة' }),
    );
    await expect(clinical.finalize('appointment-1')).resolves.toBe(true);
    expect(clinical.record.value?.encounter?.status).toBe('final');
  });
});

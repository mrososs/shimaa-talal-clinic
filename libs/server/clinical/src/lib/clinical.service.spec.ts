import type { DatabaseService, SqlExecutor } from '@clinic/server-core';
import { ClinicalService } from './clinical.service';
import { ClinicalErrorCode } from './clinical.errors';

const encounterRow = {
  id: 'encounter-1',
  appointment_id: 'appointment-1',
  child_id: 'child-1',
  status: 'draft',
  diagnosis: 'diagnosis',
  investigations: '',
  treatment_instructions: '',
  growth_observation: '',
  follow_up_days: null,
  parent_summary: '',
  revision: 1,
  updated_at: new Date('2026-09-09T10:00:00.000Z'),
  finalized_at: null,
};

const note = {
  diagnosis: ' diagnosis ',
  investigations: '',
  treatmentInstructions: '',
  growthObservation: '',
  followUpDays: null,
  parentSummary: '',
};

describe('ClinicalService', () => {
  const service = new ClinicalService({} as DatabaseService);

  it('uses the PostgreSQL target alias for a draft upsert and writes a version', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [encounterRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const saved = await service.saveDraft(
      'clinic-1',
      'appointment-1',
      'child-1',
      'member-1',
      note,
      { query } as unknown as SqlExecutor,
    );

    expect(query.mock.calls[0][0]).toContain(
      'insert into clinic.clinical_encounters as encounter',
    );
    expect(query.mock.calls[0][0]).toContain(
      'revision = encounter.revision + 1',
    );
    expect(query.mock.calls[1][0]).toContain(
      'insert into clinic.clinical_encounter_versions',
    );
    expect(saved.diagnosis).toBe('diagnosis');
  });

  it('rejects an empty measurement before touching the database', async () => {
    const query = jest.fn();

    await expect(
      service.addMeasurement('clinic-1', 'child-1', 'member-1', {}, {
        query,
      } as unknown as SqlExecutor),
    ).rejects.toMatchObject({ code: ClinicalErrorCode.InvalidMeasurement });
    expect(query).not.toHaveBeenCalled();
  });
});

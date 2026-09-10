import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type {
  ClinicalEncounter,
  ClinicalMeasurement,
  ClinicalRecord,
  CreateClinicalMeasurementInput,
  SaveClinicalEncounterInput,
} from '@clinic/contracts';
import { ClinicalError, ClinicalErrorCode } from './clinical.errors';

interface EncounterRow extends QueryResultRow {
  id: string;
  appointment_id: string;
  child_id: string;
  status: string;
  diagnosis: string;
  investigations: string;
  treatment_instructions: string;
  growth_observation: string;
  follow_up_days: number | null;
  parent_summary: string;
  revision: number;
  updated_at: Date;
  finalized_at: Date | null;
}

interface MeasurementRow extends QueryResultRow {
  id: string;
  child_id: string;
  appointment_id: string | null;
  weight_kg: string | null;
  height_cm: string | null;
  head_circumference_cm: string | null;
  temperature_c: string | null;
  measured_at: Date;
}

const ENCOUNTER_COLUMNS = `id, appointment_id, child_id, status, diagnosis,
  investigations, treatment_instructions, growth_observation, follow_up_days,
  parent_summary, revision, updated_at, finalized_at`;
const MEASUREMENT_COLUMNS = `id, child_id, appointment_id, weight_kg, height_cm,
  head_circumference_cm, temperature_c, measured_at`;

@Injectable()
export class ClinicalService {
  constructor(private readonly database: DatabaseService) {}

  async record(
    clinicId: string,
    appointmentId: string,
    childId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicalRecord> {
    const [encounter, measurements, previous] = await Promise.all([
      db.query<EncounterRow>(
        `select ${ENCOUNTER_COLUMNS} from clinic.clinical_encounters
          where clinic_id = $1 and appointment_id = $2`,
        [clinicId, appointmentId],
      ),
      db.query<MeasurementRow>(
        `select ${MEASUREMENT_COLUMNS} from clinic.clinical_measurements
          where clinic_id = $1 and child_id = $2
          order by measured_at desc, id desc limit 100`,
        [clinicId, childId],
      ),
      db.query<EncounterRow>(
        `select ${ENCOUNTER_COLUMNS} from clinic.clinical_encounters
          where clinic_id = $1 and child_id = $2 and status = 'final'
            and appointment_id <> $3
          order by finalized_at desc limit 10`,
        [clinicId, childId, appointmentId],
      ),
    ]);
    return {
      encounter: encounter.rows[0] ? toEncounter(encounter.rows[0]) : null,
      measurements: measurements.rows.map(toMeasurement),
      previousEncounters: previous.rows.map((row) => {
        const item = toEncounter(row);
        return {
          id: item.id,
          appointmentId: item.appointmentId,
          diagnosis: item.diagnosis,
          finalizedAt: item.finalizedAt,
        };
      }),
    };
  }

  async saveDraft(
    clinicId: string,
    appointmentId: string,
    childId: string,
    memberId: string,
    input: SaveClinicalEncounterInput,
    db: SqlExecutor = this.database,
  ): Promise<ClinicalEncounter> {
    const result = await db.query<EncounterRow>(
      `insert into clinic.clinical_encounters as encounter
         (clinic_id, appointment_id, child_id, diagnosis, investigations,
          treatment_instructions, growth_observation, follow_up_days,
          parent_summary, created_by_member_id, updated_by_member_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       on conflict (appointment_id) do update set
         diagnosis = excluded.diagnosis,
         investigations = excluded.investigations,
         treatment_instructions = excluded.treatment_instructions,
         growth_observation = excluded.growth_observation,
         follow_up_days = excluded.follow_up_days,
         parent_summary = excluded.parent_summary,
         revision = encounter.revision + 1,
         updated_by_member_id = excluded.updated_by_member_id,
         updated_at = now()
       where encounter.clinic_id = excluded.clinic_id
         and encounter.child_id = excluded.child_id
         and encounter.status = 'draft'
       returning ${ENCOUNTER_COLUMNS}`,
      encounterValues(clinicId, appointmentId, childId, memberId, input),
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ClinicalError(
        ClinicalErrorCode.EncounterFinalized,
        'A finalized encounter cannot be edited.',
      );
    }
    await this.writeVersion(clinicId, row, memberId, 'draft_saved', db);
    return toEncounter(row);
  }

  async finalize(
    clinicId: string,
    appointmentId: string,
    childId: string,
    memberId: string,
    input: SaveClinicalEncounterInput,
    db: SqlExecutor = this.database,
  ): Promise<ClinicalEncounter> {
    const result = await db.query<EncounterRow>(
      `insert into clinic.clinical_encounters as encounter
         (clinic_id, appointment_id, child_id, status, diagnosis,
          investigations, treatment_instructions, growth_observation,
          follow_up_days, parent_summary, created_by_member_id,
          updated_by_member_id, finalized_by_member_id, finalized_at)
       values ($1, $2, $3, 'final', $4, $5, $6, $7, $8, $9, $10, $10, $10, now())
       on conflict (appointment_id) do update set
         status = 'final',
         diagnosis = excluded.diagnosis,
         investigations = excluded.investigations,
         treatment_instructions = excluded.treatment_instructions,
         growth_observation = excluded.growth_observation,
         follow_up_days = excluded.follow_up_days,
         parent_summary = excluded.parent_summary,
         revision = encounter.revision + 1,
         updated_by_member_id = excluded.updated_by_member_id,
         finalized_by_member_id = excluded.finalized_by_member_id,
         updated_at = now(), finalized_at = now()
       where encounter.clinic_id = excluded.clinic_id
         and encounter.child_id = excluded.child_id
         and encounter.status = 'draft'
       returning ${ENCOUNTER_COLUMNS}`,
      encounterValues(clinicId, appointmentId, childId, memberId, input),
    );
    let row = result.rows[0];
    if (row === undefined) {
      row = (
        await db.query<EncounterRow>(
          `select ${ENCOUNTER_COLUMNS} from clinic.clinical_encounters
            where clinic_id = $1 and appointment_id = $2 and child_id = $3
              and status = 'final'`,
          [clinicId, appointmentId, childId],
        )
      ).rows[0];
    } else {
      await this.writeVersion(clinicId, row, memberId, 'finalized', db);
    }
    if (row === undefined) {
      throw new ClinicalError(
        ClinicalErrorCode.EncounterNotFound,
        'The encounter could not be finalized.',
      );
    }
    return toEncounter(row);
  }

  async addMeasurement(
    clinicId: string,
    childId: string,
    memberId: string,
    input: CreateClinicalMeasurementInput,
    db: SqlExecutor = this.database,
  ): Promise<ClinicalMeasurement> {
    if (!hasMeasurement(input)) {
      throw new ClinicalError(
        ClinicalErrorCode.InvalidMeasurement,
        'At least one measurement is required.',
      );
    }
    const result = await db.query<MeasurementRow>(
      `insert into clinic.clinical_measurements
         (clinic_id, child_id, appointment_id, weight_kg, height_cm,
          head_circumference_cm, temperature_c, recorded_by_member_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning ${MEASUREMENT_COLUMNS}`,
      [
        clinicId,
        childId,
        input.appointmentId ?? null,
        input.weightKg ?? null,
        input.heightCm ?? null,
        input.headCircumferenceCm ?? null,
        input.temperatureC ?? null,
        memberId,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ClinicalError(
        ClinicalErrorCode.InvalidMeasurement,
        'The measurement could not be stored.',
      );
    }
    return toMeasurement(row);
  }

  async listMeasurements(
    clinicId: string,
    childId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicalMeasurement[]> {
    const result = await db.query<MeasurementRow>(
      `select ${MEASUREMENT_COLUMNS} from clinic.clinical_measurements
        where clinic_id = $1 and child_id = $2
        order by measured_at desc, id desc limit 100`,
      [clinicId, childId],
    );
    return result.rows.map(toMeasurement);
  }

  private async writeVersion(
    clinicId: string,
    row: EncounterRow,
    memberId: string,
    action: 'draft_saved' | 'finalized',
    db: SqlExecutor,
  ): Promise<void> {
    await db.query(
      `insert into clinic.clinical_encounter_versions
         (clinic_id, encounter_id, revision, action, snapshot, actor_member_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        clinicId,
        row.id,
        row.revision,
        action,
        JSON.stringify(toEncounter(row)),
        memberId,
      ],
    );
  }
}

function encounterValues(
  clinicId: string,
  appointmentId: string,
  childId: string,
  memberId: string,
  input: SaveClinicalEncounterInput,
): unknown[] {
  return [
    clinicId,
    appointmentId,
    childId,
    input.diagnosis.trim(),
    input.investigations.trim(),
    input.treatmentInstructions.trim(),
    input.growthObservation.trim(),
    input.followUpDays,
    input.parentSummary.trim(),
    memberId,
  ];
}

function hasMeasurement(input: CreateClinicalMeasurementInput): boolean {
  return [
    input.weightKg,
    input.heightCm,
    input.headCircumferenceCm,
    input.temperatureC,
  ].some((value) => value !== undefined && value !== null);
}

function toEncounter(row: EncounterRow): ClinicalEncounter {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    childId: row.child_id,
    status: row.status as ClinicalEncounter['status'],
    diagnosis: row.diagnosis,
    investigations: row.investigations,
    treatmentInstructions: row.treatment_instructions,
    growthObservation: row.growth_observation,
    followUpDays: row.follow_up_days,
    parentSummary: row.parent_summary,
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
    finalizedAt: row.finalized_at?.toISOString() ?? null,
  };
}

function toMeasurement(row: MeasurementRow): ClinicalMeasurement {
  return {
    id: row.id,
    childId: row.child_id,
    appointmentId: row.appointment_id,
    weightKg: numberOrNull(row.weight_kg),
    heightCm: numberOrNull(row.height_cm),
    headCircumferenceCm: numberOrNull(row.head_circumference_cm),
    temperatureC: numberOrNull(row.temperature_c),
    measuredAt: row.measured_at.toISOString(),
  };
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

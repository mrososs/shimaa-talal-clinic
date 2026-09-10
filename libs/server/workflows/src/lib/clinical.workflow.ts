import { Injectable } from '@nestjs/common';
import {
  AppointmentService,
  BookingError,
  BookingErrorCode,
} from '@clinic/server-booking';
import { ClinicalService } from '@clinic/server-clinical';
import {
  AppointmentStatus,
  QueueStatus,
  type ClinicalEncounter,
  type ClinicalMeasurement,
  type ClinicalRecord,
  type CreateClinicalMeasurementInput,
  type ParentGrowthView,
  type SaveClinicalEncounterInput,
} from '@clinic/contracts';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import {
  ChildService,
  GuardianOwnershipService,
  PatientsError,
  PatientsErrorCode,
} from '@clinic/server-patients';
import { QueueEntryService } from '@clinic/server-queue';
import { CompleteQueueEntryWorkflow } from './complete-queue-entry.workflow';

@Injectable()
export class ClinicalWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly children: ChildService,
    private readonly ownership: GuardianOwnershipService,
    private readonly entries: QueueEntryService,
    private readonly clinical: ClinicalService,
    private readonly completeQueueEntry: CompleteQueueEntryWorkflow,
  ) {}

  async record(
    clinicId: string,
    appointmentId: string,
  ): Promise<ClinicalRecord> {
    const appointment = await this.requireAppointment(clinicId, appointmentId);
    return this.clinical.record(clinicId, appointment.id, appointment.childId);
  }

  async saveDraft(input: {
    clinicId: string;
    appointmentId: string;
    memberId: string;
    data: SaveClinicalEncounterInput;
  }): Promise<ClinicalEncounter> {
    const appointment = await this.requireAppointment(
      input.clinicId,
      input.appointmentId,
    );
    requireConsultationOpen(appointment.status);
    return this.clinical.saveDraft(
      input.clinicId,
      appointment.id,
      appointment.childId,
      input.memberId,
      input.data,
    );
  }

  async finalize(input: {
    clinicId: string;
    appointmentId: string;
    memberId: string;
    data: SaveClinicalEncounterInput;
  }): Promise<ClinicalEncounter> {
    return this.database.transaction(async (tx) => {
      const appointment = await this.requireAppointment(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      const existing = await this.clinical.record(
        input.clinicId,
        appointment.id,
        appointment.childId,
        tx,
      );
      if (existing.encounter?.status === 'final') return existing.encounter;
      requireConsultationOpen(appointment.status);
      const entry = await this.entries.findByAppointment(
        input.clinicId,
        appointment.id,
        tx,
      );
      if (entry === null || entry.status !== QueueStatus.InService) {
        throw new BookingError(
          BookingErrorCode.InvalidTransition,
          'The patient must be in service before finalizing the encounter.',
        );
      }

      await this.completeQueueEntry.execute(
        {
          clinicId: input.clinicId,
          entryId: entry.id,
          memberId: input.memberId,
        },
        tx,
      );
      return this.clinical.finalize(
        input.clinicId,
        appointment.id,
        appointment.childId,
        input.memberId,
        input.data,
        tx,
      );
    });
  }

  async measurements(
    clinicId: string,
    childId: string,
  ): Promise<ClinicalMeasurement[]> {
    await this.requireChild(clinicId, childId);
    return this.clinical.listMeasurements(clinicId, childId);
  }

  async parentGrowth(
    clinicId: string,
    guardianId: string,
    childId: string,
  ): Promise<ParentGrowthView> {
    await this.ownership.assertCanAccessChild(clinicId, guardianId, childId);
    const [child, measurements] = await Promise.all([
      this.children.findById(clinicId, childId),
      this.clinical.listMeasurements(clinicId, childId),
    ]);
    if (child === null) {
      throw new PatientsError(
        PatientsErrorCode.ChildNotFound,
        'No such child at this clinic.',
      );
    }
    return {
      child: {
        id: child.id,
        fullName: child.fullName,
        dateOfBirth: child.dateOfBirth,
        sex: child.sex,
      },
      measurements: measurements.map((measurement) => ({
        id: measurement.id,
        weightKg: measurement.weightKg,
        heightCm: measurement.heightCm,
        headCircumferenceCm: measurement.headCircumferenceCm,
        measuredAt: measurement.measuredAt,
      })),
    };
  }

  async addMeasurement(input: {
    clinicId: string;
    childId: string;
    memberId: string;
    data: CreateClinicalMeasurementInput;
  }): Promise<ClinicalMeasurement> {
    await this.requireChild(input.clinicId, input.childId);
    if (input.data.appointmentId) {
      const appointment = await this.requireAppointment(
        input.clinicId,
        input.data.appointmentId,
      );
      if (appointment.childId !== input.childId) {
        throw new BookingError(
          BookingErrorCode.ChildNotAccessible,
          'The appointment belongs to another child.',
        );
      }
    }
    return this.clinical.addMeasurement(
      input.clinicId,
      input.childId,
      input.memberId,
      input.data,
    );
  }

  private async requireAppointment(
    clinicId: string,
    appointmentId: string,
    db: SqlExecutor = this.database,
  ) {
    const appointment = await this.appointments.findById(
      clinicId,
      appointmentId,
      db,
    );
    if (appointment === null) {
      throw new BookingError(
        BookingErrorCode.AppointmentNotFound,
        'No such appointment.',
      );
    }
    return appointment;
  }

  private async requireChild(clinicId: string, childId: string): Promise<void> {
    if ((await this.children.findById(clinicId, childId)) === null) {
      throw new PatientsError(
        PatientsErrorCode.ChildNotFound,
        'No such child at this clinic.',
      );
    }
  }
}

function requireConsultationOpen(status: string): void {
  if (status !== AppointmentStatus.CheckedIn) {
    throw new BookingError(
      BookingErrorCode.InvalidTransition,
      'Only a checked-in appointment can have an editable encounter.',
    );
  }
}

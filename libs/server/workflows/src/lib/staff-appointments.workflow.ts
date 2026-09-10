import { Injectable } from '@nestjs/common';
import type { SqlExecutor } from '@clinic/server-core';
import { AppointmentService } from '@clinic/server-booking';
import { PatientDirectoryService } from '@clinic/server-patients';
import {
  AppointmentStatus,
  type AppointmentListItem,
  type ChildSummary,
  type GuardianSummary,
} from '@clinic/contracts';

export interface StaffAppointmentsInput {
  clinicId: string;
  date: string;
  to?: string;
}

const UNKNOWN_CHILD = (id: string): ChildSummary => ({
  id,
  fullName: '—',
  dateOfBirth: null,
});

const UNKNOWN_GUARDIAN = (id: string): GuardianSummary => ({
  id,
  fullName: '—',
  phoneE164: '',
});

/**
 * The clinic's appointment day enriched with the identities staff need.
 *
 * Booking owns the appointment and Patients owns names and phone numbers, so
 * neither domain can build this response on its own. This read workflow keeps
 * that composition at the orchestration boundary and preserves the existing
 * `/clinic/appointments` contract path for clients.
 */
@Injectable()
export class StaffAppointmentsWorkflow {
  constructor(
    private readonly appointments: AppointmentService,
    private readonly directory: PatientDirectoryService,
  ) {}

  async execute(
    input: StaffAppointmentsInput,
    db?: SqlExecutor,
  ): Promise<AppointmentListItem[]> {
    const appointments = input.to
      ? await this.appointments.listForRange(
          input.clinicId,
          input.date,
          input.to,
          db,
        )
      : await this.appointments.listForDay(input.clinicId, input.date, db);

    const [children, guardians] = await Promise.all([
      this.directory.childSummaries(
        input.clinicId,
        appointments.map((appointment) => appointment.childId),
        db,
      ),
      this.directory.guardianSummaries(
        input.clinicId,
        appointments.map((appointment) => appointment.guardianId),
        db,
      ),
    ]);

    const now = Date.now();
    return appointments.map((appointment): AppointmentListItem => ({
      ...appointment,
      child:
        children.get(appointment.childId) ?? UNKNOWN_CHILD(appointment.childId),
      guardian:
        guardians.get(appointment.guardianId) ??
        UNKNOWN_GUARDIAN(appointment.guardianId),
      // Requested/confirmed appointments have not entered Queue yet. Once a
      // check-in creates an entry, the same transaction changes the booking to
      // checked_in, so terminal and arrived visits must never be labelled late.
      isLate:
        (appointment.status === AppointmentStatus.Requested ||
          appointment.status === AppointmentStatus.Confirmed) &&
        Date.parse(appointment.windowEnd) < now,
    }));
  }
}

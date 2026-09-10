import { Injectable } from '@nestjs/common';
import type { SqlExecutor } from '@clinic/server-core';
import { AppointmentService } from '@clinic/server-booking';
import { ChildService, GuardianService, PatientsError, PatientsErrorCode } from '@clinic/server-patients';
import type { Appointment, FamilyVisitSummary, StaffFamilyRecord } from '@clinic/contracts';

export interface StaffFamilyRecordInput {
  clinicId: string;
  guardianId: string;
}

/**
 * The operational family record without crossing domain boundaries in either
 * Patients or Booking. Clinical notes are deliberately absent from its public
 * response; D5 owns those records and their stricter permissions.
 */
@Injectable()
export class StaffFamilyRecordWorkflow {
  constructor(
    private readonly guardians: GuardianService,
    private readonly children: ChildService,
    private readonly appointments: AppointmentService,
  ) {}

  async execute(
    input: StaffFamilyRecordInput,
    db?: SqlExecutor,
  ): Promise<StaffFamilyRecord> {
    const guardian = await this.guardians.findById(
      input.clinicId,
      input.guardianId,
      db,
    );
    if (guardian === null) {
      throw new PatientsError(
        PatientsErrorCode.GuardianNotFound,
        'No such guardian at this clinic.',
      );
    }

    const [children, upcoming, past] = await Promise.all([
      this.children.listForGuardian(input.clinicId, input.guardianId, db),
      this.appointments.listForGuardian(
        input.clinicId,
        input.guardianId,
        'upcoming',
        db,
      ),
      this.appointments.listForGuardian(
        input.clinicId,
        input.guardianId,
        'past',
        db,
      ),
    ]);

    return {
      guardian,
      children,
      upcomingVisits: upcoming.map(toVisit),
      pastVisits: past.map(toVisit),
    };
  }
}

function toVisit(appointment: Appointment): FamilyVisitSummary {
  return {
    id: appointment.id,
    childId: appointment.childId,
    windowStart: appointment.windowStart,
    windowEnd: appointment.windowEnd,
    visitType: appointment.visitType,
    status: appointment.status,
  };
}

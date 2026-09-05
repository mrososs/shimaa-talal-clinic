import { Injectable } from '@nestjs/common';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { AppointmentService } from '@clinic/server-booking';
import { QueueCommandService, QueueEntryService } from '@clinic/server-queue';
import { AppointmentStatus, type Appointment } from '@clinic/contracts';

export interface CancelInput {
  clinicId: string;
  appointmentId: string;
  /** Staff cancelling. Absent means the parent did it themselves. */
  memberId?: string | null;
  authUserId?: string | null;
  reason?: string | null;
  /** Apply the clinic's cutoff. True for a parent, false for staff. */
  enforceCutoff?: boolean;
}

/**
 * Call a visit off, wherever it had got to.
 *
 * If the family had already checked in, their queue entry goes with it. Without
 * that, the board keeps a patient nobody is expecting — a ghost that reception
 * eventually has to explain, and that "call next" would happily announce.
 *
 * Both halves commit together, because a cancelled appointment with a live
 * queue entry is worse than either alone.
 */
@Injectable()
export class CancelAppointmentWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly queue: QueueCommandService,
    private readonly entries: QueueEntryService,
  ) {}

  async execute(input: CancelInput, db?: SqlExecutor): Promise<Appointment> {
    const run = async (tx: SqlExecutor): Promise<Appointment> => {
      // Read the entry before cancelling: `queue_appointment_uq` ignores
      // cancelled rows, and the appointment's own status is about to change.
      const entry = await this.entries.findByAppointment(
        input.clinicId,
        input.appointmentId,
        tx,
      );

      const actor = {
        memberId: input.memberId ?? null,
        authUserId: input.authUserId ?? null,
        reason: input.reason ?? null,
      };

      // The parent path carries the clinic's cutoff; staff have no such limit,
      // because somebody has to be able to cancel when a family phones five
      // minutes before. The rule lives in Booking either way.
      const appointment =
        input.enforceCutoff === true
          ? await this.appointments.cancelAsParent(
              input.clinicId,
              input.appointmentId,
              actor,
              tx,
            )
          : await this.appointments.transition(
              input.clinicId,
              input.appointmentId,
              AppointmentStatus.Cancelled,
              actor,
              tx,
            );

      if (entry !== null) {
        await this.queue.cancel(input.clinicId, entry.id, actor, tx);
      }

      return appointment;
    };

    return db === undefined ? this.database.transaction(run) : run(db);
  }
}

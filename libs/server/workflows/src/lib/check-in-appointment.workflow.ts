import { Injectable } from '@nestjs/common';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { AppointmentService } from '@clinic/server-booking';
import { QueueCommandService, QueueEntryService } from '@clinic/server-queue';
import {
  AppointmentStatus,
  type Appointment,
  type QueueEntry,
} from '@clinic/contracts';

export interface CheckInInput {
  clinicId: string;
  appointmentId: string;
  memberId: string;
}

/**
 * The patient has arrived.
 *
 * This is the one place Booking and Queue touch, and it is the reason this
 * library exists. A queue entry must appear and the appointment must become
 * `checked_in` together — a commit that did one without the other leaves either
 * a patient waiting who is not on the board, or a board entry for a visit the
 * clinic still thinks has not started.
 *
 * Neither domain may import the other, so neither can do this alone. The
 * workflow opens one transaction and passes the executor down; both domains
 * write inside it, and PostgreSQL decides whether both happen or neither.
 *
 * It holds no rules of its own. "Is this appointment eligible to check in"
 * lives in Booking, "what number does this patient get" lives in Queue. This
 * class only sequences them — if it started deciding things, the rule would
 * have two homes.
 */
@Injectable()
export class CheckInAppointmentWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly queue: QueueCommandService,
    private readonly entries: QueueEntryService,
  ) {}

  async execute(input: CheckInInput, db?: SqlExecutor): Promise<QueueEntry> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry> => {
      // Checking the same patient in twice is a double-click at a busy desk,
      // not an error, so it is answered before anything is validated. Asking
      // Booking first would refuse it: the appointment is `checked_in` by
      // then, and "not confirmed" is a true statement that answers the wrong
      // question.
      const existing = await this.entries.findByAppointment(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (existing !== null) return existing;

      const appointment = await this.eligible(input, tx);
      if (isEntry(appointment)) return appointment;

      const entry = await this.queue.admit(
        {
          clinicId: input.clinicId,
          sessionId: appointment.sessionId,
          childId: appointment.childId,
          guardianId: appointment.guardianId,
          appointmentId: appointment.id,
          visitReason: appointment.notes,
        },
        { memberId: input.memberId },
        tx,
      );

      await this.appointments.transition(
        input.clinicId,
        appointment.id,
        AppointmentStatus.CheckedIn,
        { memberId: input.memberId },
        tx,
      );

      return entry;
    };

    // One transaction, or the two halves can disagree. A caller that already
    // holds one passes it in rather than nesting a second.
    return db === undefined ? this.database.transaction(run) : run(db);
  }

  /**
   * The appointment, locked and eligible — or the entry a racing desk created.
   *
   * `findForCheckIn` takes the appointment's row lock, so two receptionists
   * checking the same patient in at the same instant meet here. The loser waits,
   * then reads a row the winner has already moved to `checked_in` and is
   * refused. That refusal is not the honest answer: the patient is in the queue,
   * which is what the caller asked for, so the winner's entry is returned
   * instead.
   *
   * The re-read matters. An appointment that is ineligible for any other reason
   * — cancelled, still awaiting approval — has no entry, so the error survives.
   */
  private async eligible(
    input: CheckInInput,
    tx: SqlExecutor,
  ): Promise<Appointment | QueueEntry> {
    try {
      return await this.appointments.findForCheckIn(
        input.clinicId,
        input.appointmentId,
        tx,
      );
    } catch (error) {
      const raced = await this.entries.findByAppointment(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (raced !== null) return raced;
      throw error;
    }
  }
}

/** Distinguishes the two things `eligible` can hand back. */
function isEntry(value: Appointment | QueueEntry): value is QueueEntry {
  return 'ticketNumber' in value;
}

import { Injectable } from '@nestjs/common';
import { AppointmentService } from '@clinic/server-booking';
import { QueueCommandService } from '@clinic/server-queue';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { AppointmentStatus, type QueueEntry } from '@clinic/contracts';

export interface RemoveQueueEntryInput {
  clinicId: string;
  entryId: string;
  memberId: string;
  reason: string | null;
}

/**
 * The patient is leaving without being seen.
 *
 * Removing someone from the board used to touch Queue alone, which left the
 * booking behind at `checked_in`: an appointment the clinic believed was in
 * progress, for a patient who had gone home. It counted as an arrival in every
 * report and belonged to no list on either screen.
 *
 * They did arrive, so this is not a no-show — that would be a false statement
 * about a family who came. It is a cancellation after arrival, and the pair of
 * events is what preserves the difference: the queue entry keeps its
 * `checked_in` event and gains a `cancelled` one, and the appointment records
 * who cancelled it and why.
 *
 * Booking already expects this to be a workflow rather than a service call —
 * `checked_in → cancelled` is legal in its transition table precisely because
 * the cascade has to reach the queue, and neither domain may import the other.
 */
@Injectable()
export class RemoveQueueEntryWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly queue: QueueCommandService,
    private readonly appointments: AppointmentService,
  ) {}

  execute(input: RemoveQueueEntryInput, db?: SqlExecutor): Promise<QueueEntry> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry> => {
      // Queue decides whether the removal is legal at all: a patient in the
      // room or already finished is refused here, before Booking is touched.
      const entry = await this.queue.cancel(
        input.clinicId,
        input.entryId,
        { memberId: input.memberId, reason: input.reason },
        tx,
      );

      // A walk-in has no booking to keep in step, and none is invented for it.
      if (entry.appointmentId === null) return entry;

      // Only a visit still believed to be in progress needs correcting. A
      // missed entry's appointment is already `no_show` and a completed one is
      // already terminal; both are coherent, and Booking's table forbids moving
      // them again.
      const appointment = await this.appointments.findById(
        input.clinicId,
        entry.appointmentId,
        tx,
      );
      if (appointment?.status !== AppointmentStatus.CheckedIn) return entry;

      await this.appointments.transition(
        input.clinicId,
        entry.appointmentId,
        AppointmentStatus.Cancelled,
        { memberId: input.memberId, reason: input.reason },
        tx,
      );

      return entry;
    };

    // One transaction, or the board and the booking can disagree — which is
    // the defect this workflow exists to prevent.
    return db === undefined ? this.database.transaction(run) : run(db);
  }
}

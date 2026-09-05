import { Injectable } from '@nestjs/common';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { AppointmentService } from '@clinic/server-booking';
import { QueueCommandService, QueueEntryService } from '@clinic/server-queue';
import { AppointmentStatus, type QueueEntry } from '@clinic/contracts';

export interface CompleteInput {
  clinicId: string;
  entryId: string;
  memberId: string;
}

/**
 * The consultation is over.
 *
 * The queue entry finishes and, if there was an appointment behind it, that
 * finishes too — in one commit. Otherwise the day's list would show a visit as
 * still pending long after the family had gone home.
 *
 * A walk-in has no appointment, and that is the ordinary case rather than a
 * special one: the second half simply has nothing to do.
 */
@Injectable()
export class CompleteQueueEntryWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly queue: QueueCommandService,
    private readonly entries: QueueEntryService,
  ) {}

  async execute(input: CompleteInput, db?: SqlExecutor): Promise<QueueEntry> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry> => {
      const entry = await this.queue.complete(
        input.clinicId,
        input.entryId,
        { memberId: input.memberId },
        tx,
      );

      if (entry.appointmentId !== null) {
        await this.appointments.transition(
          input.clinicId,
          entry.appointmentId,
          AppointmentStatus.Completed,
          { memberId: input.memberId },
          tx,
        );
      }

      return entry;
    };

    return db === undefined ? this.database.transaction(run) : run(db);
  }

  /**
   * The entry, if the caller needs to know what it was before completing.
   *
   * Exposed so a controller can answer "no such patient" without reaching past
   * the queue library's barrel itself.
   */
  find(clinicId: string, entryId: string): Promise<QueueEntry | null> {
    return this.entries.findById(clinicId, entryId);
  }
}

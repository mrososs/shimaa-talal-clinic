import { Injectable } from '@nestjs/common';
import { AppointmentService } from '@clinic/server-booking';
import { AppointmentStatus, type QueueEntry } from '@clinic/contracts';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { QueueCommandService } from '@clinic/server-queue';

export interface CallNextInput {
  clinicId: string;
  sessionId: string;
  memberId: string;
}

/** Calls the next eligible patient without ending an active consultation. */
@Injectable()
export class CallNextWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly queue: QueueCommandService,
  ) {}

  execute(input: CallNextInput, db?: SqlExecutor): Promise<QueueEntry | null> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry | null> => {
      const result = await this.queue.callNext(
        input.clinicId,
        input.sessionId,
        { memberId: input.memberId },
        tx,
      );

      if (result.missed?.appointmentId) {
        await this.appointments.transition(
          input.clinicId,
          result.missed.appointmentId,
          AppointmentStatus.NoShow,
          { memberId: input.memberId },
          tx,
        );
      }

      return result.called;
    };

    return db === undefined ? this.database.transaction(run) : run(db);
  }
}

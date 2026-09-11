import { Injectable } from '@nestjs/common';
import { AppointmentService } from '@clinic/server-booking';
import { AppointmentStatus, type QueueEntry } from '@clinic/contracts';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { QueueCommandService } from '@clinic/server-queue';
import { PaymentService } from '@clinic/server-payments';

export interface CompleteAndCallNextInput {
  clinicId: string;
  sessionId: string;
  memberId: string;
}

/** Completes the current patient and calls the next in one transaction. */
@Injectable()
export class CompleteAndCallNextWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly queue: QueueCommandService,
    private readonly payments: PaymentService,
  ) {}

  execute(
    input: CompleteAndCallNextInput,
    db?: SqlExecutor,
  ): Promise<QueueEntry | null> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry | null> => {
      const result = await this.queue.completeAndCallNext(
        input.clinicId,
        input.sessionId,
        { memberId: input.memberId },
        tx,
      );

      if (result.completed?.appointmentId) {
        await this.appointments.transition(
          input.clinicId,
          result.completed.appointmentId,
          AppointmentStatus.Completed,
          { memberId: input.memberId },
          tx,
        );
      }
      if (result.missed?.appointmentId) {
        const appointmentId = result.missed.appointmentId;
        await this.appointments.transition(
          input.clinicId,
          appointmentId,
          AppointmentStatus.NoShow,
          { memberId: input.memberId },
          tx,
        );
        await this.payments.voidPendingCashForNoShow(
          input.clinicId,
          appointmentId,
          input.memberId,
          tx,
        );
      }

      return result.called;
    };

    return db === undefined ? this.database.transaction(run) : run(db);
  }
}

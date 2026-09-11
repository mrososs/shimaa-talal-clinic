import { Injectable } from '@nestjs/common';
import { AppointmentService } from '@clinic/server-booking';
import { PaymentService } from '@clinic/server-payments';
import { QueueCommandService } from '@clinic/server-queue';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import type { QueueEntry } from '@clinic/contracts';

export interface RequeueEntryInput {
  clinicId: string;
  entryId: string;
  memberId: string;
}

/** Returns a missed patient and their linked booking/payment state together. */
@Injectable()
export class RequeueEntryWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly queue: QueueCommandService,
    private readonly appointments: AppointmentService,
    private readonly payments: PaymentService,
  ) {}

  execute(input: RequeueEntryInput, db?: SqlExecutor): Promise<QueueEntry> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry> => {
      const entry = await this.queue.requeue(
        input.clinicId,
        input.entryId,
        { memberId: input.memberId },
        tx,
      );
      if (entry.appointmentId !== null) {
        await this.appointments.restoreNoShowCheckIn(
          input.clinicId,
          entry.appointmentId,
          { memberId: input.memberId },
          tx,
        );
        await this.payments.restoreCashAfterRequeue(
          input.clinicId,
          entry.appointmentId,
          input.memberId,
          tx,
        );
      }
      return entry;
    };
    return db === undefined ? this.database.transaction(run) : run(db);
  }
}

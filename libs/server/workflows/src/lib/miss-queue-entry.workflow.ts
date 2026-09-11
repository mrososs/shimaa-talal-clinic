import { Injectable } from '@nestjs/common';
import { AppointmentService } from '@clinic/server-booking';
import { PaymentService } from '@clinic/server-payments';
import { QueueCommandService } from '@clinic/server-queue';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { AppointmentStatus, type QueueEntry } from '@clinic/contracts';

export interface MissQueueEntryInput {
  clinicId: string;
  entryId: string;
  memberId: string;
  force: boolean;
  reason: string | null;
}

/** Misses Queue, Booking and an uncollected cash promise in one transaction. */
@Injectable()
export class MissQueueEntryWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly queue: QueueCommandService,
    private readonly appointments: AppointmentService,
    private readonly payments: PaymentService,
  ) {}

  execute(input: MissQueueEntryInput, db?: SqlExecutor): Promise<QueueEntry> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry> => {
      const entry = await this.queue.miss(
        input.clinicId,
        input.entryId,
        {
          memberId: input.memberId,
          force: input.force,
          reason: input.reason,
        },
        tx,
      );
      if (entry.appointmentId !== null) {
        await this.appointments.transition(
          input.clinicId,
          entry.appointmentId,
          AppointmentStatus.NoShow,
          { memberId: input.memberId, reason: input.reason },
          tx,
        );
        await this.payments.voidPendingCashForNoShow(
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

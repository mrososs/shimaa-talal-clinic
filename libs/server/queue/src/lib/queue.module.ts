import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';
import { ClinicModule } from '@clinic/server-clinic';
import { ClinicQueueController } from './api/clinic-queue.controller';
import { MyQueueController } from './api/my-queue.controller';
import { QueueCommandService } from './queue-command.service';
import { QueueEntryService } from './queue-entry.service';

/**
 * Queue — who is here, in what order, and who is next.
 *
 * Depends on the clinic (for the session it locks and the policy it reads) and
 * on nothing else. It has no idea Booking exists: `appointment_id` is an opaque
 * uuid to this library, and joining a check-in to an appointment is a workflow
 * above both.
 */
@Module({
  imports: [ServerCoreModule, ClinicModule],
  controllers: [ClinicQueueController, MyQueueController],
  providers: [QueueEntryService, QueueCommandService],
  exports: [QueueEntryService, QueueCommandService],
})
export class QueueModule {}

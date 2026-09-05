import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';
import { BookingModule } from '@clinic/server-booking';
import { QueueModule } from '@clinic/server-queue';
import { PatientsModule } from '@clinic/server-patients';
import { ClinicModule } from '@clinic/server-clinic';
import { ParentQueueController } from './api/parent-queue.controller';
import { QueueBoardController } from './api/queue-board.controller';
import { WorkflowsController } from './api/workflows.controller';
import { ClinicQueueBoardWorkflow } from './clinic-queue-board.workflow';
import { ParentQueueViewWorkflow } from './parent-queue-view.workflow';
import { CancelAppointmentWorkflow } from './cancel-appointment.workflow';
import { CheckInAppointmentWorkflow } from './check-in-appointment.workflow';
import { CompleteQueueEntryWorkflow } from './complete-queue-entry.workflow';

/**
 * Cross-domain orchestration.
 *
 * The one project allowed to depend on several domains at once. Domains stay
 * unaware of each other; a workflow sees several of them. Dependencies point
 * inward, one level, and never back — nothing lists `scope:orchestration` as a
 * permitted dependency, so no domain can depend on this library.
 *
 * Three rules that make this work (see docs/cross-domain-orchestration.md):
 *
 *   1. A workflow opens ONE `database.transaction()` and passes the resulting
 *      `SqlExecutor` down, so every domain writes in the same commit. Never
 *      nest transactions.
 *   2. It depends on intent-shaped services exported from each domain's public
 *      `index.ts`. Never reach past the barrel.
 *   3. External side effects (notifications, payment providers) happen AFTER
 *      commit — never inside the transaction.
 *
 * Workflows sequence; they do not hold domain rules. "Is this appointment
 * eligible to check in" lives in Booking; "what number does this patient get"
 * lives in Queue. If a workflow needs something new from a domain, it is added
 * to that domain's public interface deliberately.
 *
 * Two reads live here as well. The staff board and the parent's own view are
 * both compositions rather than queries — order from Queue, names from
 * Patients, today's visit from Booking, the day from Clinic — and the same rule
 * that keeps check-in out of Booking keeps them out of Queue.
 *
 * This is not a workflow engine, and it is not going to become one. Five
 * classes, no event bus, no saga, no command bus.
 */
@Module({
  imports: [
    ServerCoreModule,
    ClinicModule,
    BookingModule,
    QueueModule,
    PatientsModule,
  ],
  controllers: [WorkflowsController, QueueBoardController, ParentQueueController],
  providers: [
    CheckInAppointmentWorkflow,
    CompleteQueueEntryWorkflow,
    CancelAppointmentWorkflow,
    ClinicQueueBoardWorkflow,
    ParentQueueViewWorkflow,
  ],
  exports: [
    CheckInAppointmentWorkflow,
    CompleteQueueEntryWorkflow,
    CancelAppointmentWorkflow,
    ClinicQueueBoardWorkflow,
    ParentQueueViewWorkflow,
  ],
})
export class WorkflowsModule {}

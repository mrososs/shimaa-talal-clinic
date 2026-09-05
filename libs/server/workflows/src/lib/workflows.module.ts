import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';
import { BookingModule } from '@clinic/server-booking';
import { QueueModule } from '@clinic/server-queue';
import { WorkflowsController } from './api/workflows.controller';
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
 * This is not a workflow engine, and it is not going to become one. Three
 * classes, no event bus, no saga, no command bus.
 */
@Module({
  imports: [ServerCoreModule, BookingModule, QueueModule],
  controllers: [WorkflowsController],
  providers: [
    CheckInAppointmentWorkflow,
    CompleteQueueEntryWorkflow,
    CancelAppointmentWorkflow,
  ],
  exports: [
    CheckInAppointmentWorkflow,
    CompleteQueueEntryWorkflow,
    CancelAppointmentWorkflow,
  ],
})
export class WorkflowsModule {}

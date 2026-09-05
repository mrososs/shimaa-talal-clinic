/**
 * `@clinic/server-workflows` — cross-domain orchestration.
 *
 * Three classes, each sequencing a change that has to commit across more than
 * one domain. Nothing else belongs here: a rule about what makes a booking
 * valid lives in Booking, and one about who is served next lives in Queue.
 */
export * from './lib/workflows.module';
export {
  CheckInAppointmentWorkflow,
  type CheckInInput,
} from './lib/check-in-appointment.workflow';
export {
  CompleteQueueEntryWorkflow,
  type CompleteInput,
} from './lib/complete-queue-entry.workflow';
export {
  CancelAppointmentWorkflow,
  type CancelInput,
} from './lib/cancel-appointment.workflow';

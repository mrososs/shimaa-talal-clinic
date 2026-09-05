/**
 * `@clinic/server-workflows` — cross-domain orchestration.
 *
 * Four classes: three that sequence a change committing across more than one
 * domain, and one that composes the board those changes are made from. Nothing
 * else belongs here — a rule about what makes a booking valid lives in Booking,
 * and one about who is served next lives in Queue.
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
export { ClinicQueueBoardWorkflow } from './lib/clinic-queue-board.workflow';

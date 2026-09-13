/**
 * `@clinic/server-workflows` — cross-domain orchestration.
 *
 * Commands sequence changes that commit across more than one domain, while
 * query workflows compose the board those changes are made from. Nothing
 * else belongs here — a rule about what makes a booking valid lives in Booking,
 * and one about who is served next lives in Queue.
 */
export * from './lib/workflows.module';
export * from './lib/urgent-case.workflow';
export * from './lib/payments-report.workflow';
export {
  AppointmentTrackingWorkflow,
  calculateEstimate,
  type CalculateEstimateInput,
  type EstimateCalculation,
  type RawEstimate,
} from './lib/appointment-tracking.workflow';
export { AppointmentTrackingCapabilityService } from './lib/appointment-tracking-capability.service';
export {
  CheckInAppointmentWorkflow,
  type CheckInInput,
} from './lib/check-in-appointment.workflow';
export {
  CompleteQueueEntryWorkflow,
  type CompleteInput,
} from './lib/complete-queue-entry.workflow';
export { CallNextWorkflow, type CallNextInput } from './lib/call-next.workflow';
export {
  CompleteAndCallNextWorkflow,
  type CompleteAndCallNextInput,
} from './lib/complete-and-call-next.workflow';
export {
  CancelAppointmentWorkflow,
  type CancelInput,
} from './lib/cancel-appointment.workflow';
export {
  RemoveQueueEntryWorkflow,
  type RemoveQueueEntryInput,
} from './lib/remove-queue-entry.workflow';
export { ClinicQueueBoardWorkflow } from './lib/clinic-queue-board.workflow';
export {
  StaffAppointmentsWorkflow,
  type StaffAppointmentsInput,
} from './lib/staff-appointments.workflow';
export {
  DashboardSummaryWorkflow,
  type DashboardSummaryInput,
} from './lib/dashboard-summary.workflow';
export {
  StaffFamilyRecordWorkflow,
  type StaffFamilyRecordInput,
} from './lib/staff-family-record.workflow';
export {
  ParentQueueViewWorkflow,
  type ParentQueueInput,
} from './lib/parent-queue-view.workflow';
export { ClinicalWorkflow } from './lib/clinical.workflow';

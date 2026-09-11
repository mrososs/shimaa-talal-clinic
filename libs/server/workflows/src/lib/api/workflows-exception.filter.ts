import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { BookingError } from '@clinic/server-booking';
import { QueueError } from '@clinic/server-queue';
import { PatientsError } from '@clinic/server-patients';
import { ClinicalError } from '@clinic/server-clinical';
import { MessagesError } from '@clinic/server-notifications';
import { PaymentsError } from '@clinic/server-payments';

/** Structural subset of the response, so this file needs no HTTP driver types. */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * A workflow can fail for either domain's reasons, so this filter catches both.
 *
 * It does not invent a status of its own. Each domain already decided what its
 * codes mean over HTTP, and re-deciding here would let the two answers drift —
 * the same `slot_unavailable` returning 409 from one route and 400 from
 * another.
 */
const STATUS: Record<string, number> = {
  // Booking
  appointment_not_found: 404,
  slot_unavailable: 409,
  session_unavailable: 409,
  window_in_past: 400,
  invalid_transition: 409,
  cancellation_too_late: 409,
  child_not_accessible: 404,

  // Queue
  queue_entry_not_found: 404,
  queue_guest_link_unavailable: 404,
  queue_conflict: 409,
  queue_invalid_transition: 409,
  queue_session_not_running: 409,
  queue_empty: 409,
  queue_current_patient_still_in_service: 409,
  queue_child_not_accessible: 404,
  queue_grace_not_expired: 409,
  queue_defer_limit_reached: 409,
  queue_reason_required: 400,

  // Patients (for cross-domain family reads and commands)
  guardian_not_found: 404,
  child_not_found: 404,

  // Clinical
  clinical_encounter_finalized: 409,
  clinical_encounter_not_found: 404,
  clinical_invalid_measurement: 400,

  // Messages and urgent triage
  message_thread_not_found: 404,
  message_thread_closed: 409,
  message_no_doctor_available: 409,
  urgent_case_not_found: 404,
  urgent_case_already_decided: 409,
  message_invalid_participant: 400,

  // Payments
  payment_not_found: 404,
  payment_invalid_transition: 409,
  payment_missed_reschedule_requires_paid: 409,
};

@Catch(
  BookingError,
  QueueError,
  PatientsError,
  ClinicalError,
  MessagesError,
  PaymentsError,
)
export class WorkflowsExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      | BookingError
      | QueueError
      | PatientsError
      | ClinicalError
      | MessagesError
      | PaymentsError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    response
      .status(STATUS[exception.code] ?? 500)
      .json(
        apiFailure(
          exception.code,
          exception.message,
          'details' in exception ? exception.details : undefined,
        ),
      );
  }
}

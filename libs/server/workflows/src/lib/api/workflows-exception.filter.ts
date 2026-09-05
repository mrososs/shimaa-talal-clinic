import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { BookingError } from '@clinic/server-booking';
import { QueueError } from '@clinic/server-queue';

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
  queue_conflict: 409,
  queue_invalid_transition: 409,
  queue_session_not_running: 409,
  queue_empty: 409,
  queue_grace_not_expired: 409,
  queue_defer_limit_reached: 409,
  queue_reason_required: 400,
};

@Catch(BookingError, QueueError)
export class WorkflowsExceptionFilter implements ExceptionFilter {
  catch(exception: BookingError | QueueError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    response
      .status(STATUS[exception.code] ?? 500)
      .json(apiFailure(exception.code, exception.message, exception.details));
  }
}

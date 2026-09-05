import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { BookingError, BookingErrorCode } from '../booking.errors';

/** Structural subset of the response, so this file needs no HTTP driver types. */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * Turns a booking rule violation into an HTTP answer.
 *
 * The domain's own code becomes the API's error code — `slot_unavailable`, not
 * `conflict`. A screen deciding whether to re-render availability or to explain
 * a cutoff needs to know *which* conflict occurred, and a status alone cannot
 * say.
 */
const STATUS_BY_CODE: Record<BookingErrorCode, number> = {
  [BookingErrorCode.AppointmentNotFound]: HttpStatus.NOT_FOUND,

  // The expected outcome of a race, not a fault. The body carries fresh
  // availability so the screen can offer the next window.
  [BookingErrorCode.SlotUnavailable]: HttpStatus.CONFLICT,

  [BookingErrorCode.SessionUnavailable]: HttpStatus.CONFLICT,
  [BookingErrorCode.WindowInPast]: HttpStatus.BAD_REQUEST,
  [BookingErrorCode.InvalidTransition]: HttpStatus.CONFLICT,
  [BookingErrorCode.CancellationTooLate]: HttpStatus.CONFLICT,

  // Not 403: confirming that a child exists somewhere else is the leak.
  [BookingErrorCode.ChildNotAccessible]: HttpStatus.NOT_FOUND,
};

@Catch(BookingError)
export class BookingExceptionFilter implements ExceptionFilter {
  catch(exception: BookingError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status =
      STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    // `details` appears only when the domain deliberately attached something
    // the client can act on — never the `cause`, which holds the driver error
    // and stays on the server.
    response
      .status(status)
      .json(apiFailure(exception.code, exception.message, exception.details));
  }
}

import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { ClinicError, ClinicErrorCode } from '../clinic.errors';

/** Structural subset of the response, so this file needs no HTTP driver types. */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * Turns a clinic rule violation into an HTTP answer.
 *
 * The domain's own code becomes the API's error code, because a status alone
 * cannot tell a dashboard whether to offer "reopen" (it never should) or to
 * explain that the clinic does not run that day.
 */
const STATUS_BY_CODE: Record<ClinicErrorCode, number> = {
  [ClinicErrorCode.ClinicNotFound]: HttpStatus.NOT_FOUND,
  [ClinicErrorCode.SessionNotFound]: HttpStatus.NOT_FOUND,

  // Closing is final. Asking again is a conflict with a decision already made,
  // not a malformed request.
  [ClinicErrorCode.SessionClosed]: HttpStatus.CONFLICT,

  [ClinicErrorCode.NoScheduleForDate]: HttpStatus.CONFLICT,
};

@Catch(ClinicError)
export class ClinicExceptionFilter implements ExceptionFilter {
  catch(exception: ClinicError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status =
      STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    response
      .status(status)
      .json(apiFailure(exception.code, exception.message));
  }
}

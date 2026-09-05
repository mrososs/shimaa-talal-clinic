import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { QueueError, QueueErrorCode } from '../queue.errors';

/** Structural subset of the response, so this file needs no HTTP driver types. */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * Turns a queue rule violation into an HTTP answer.
 *
 * The domain's own code becomes the API's error code. A board deciding whether
 * to re-read itself, explain a grace deadline, or tell a parent they are out of
 * deferrals needs to know *which* refusal this was, and a status cannot say.
 */
const STATUS_BY_CODE: Record<QueueErrorCode, number> = {
  [QueueErrorCode.EntryNotFound]: HttpStatus.NOT_FOUND,

  // Somebody moved first. The board is stale, not broken — the client re-reads.
  [QueueErrorCode.Conflict]: HttpStatus.CONFLICT,
  [QueueErrorCode.InvalidTransition]: HttpStatus.CONFLICT,

  [QueueErrorCode.SessionNotRunning]: HttpStatus.CONFLICT,
  [QueueErrorCode.QueueEmpty]: HttpStatus.CONFLICT,

  // The patient still has time. Not a fault, a deadline.
  [QueueErrorCode.GraceNotExpired]: HttpStatus.CONFLICT,

  [QueueErrorCode.DeferLimitReached]: HttpStatus.CONFLICT,
  [QueueErrorCode.ReasonRequired]: HttpStatus.BAD_REQUEST,
};

@Catch(QueueError)
export class QueueExceptionFilter implements ExceptionFilter {
  catch(exception: QueueError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status =
      STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    // `details` appears only when the domain deliberately attached something
    // the client can act on — a grace deadline, a defer limit. Never `cause`,
    // which holds the driver error and stays on the server.
    response
      .status(status)
      .json(apiFailure(exception.code, exception.message, exception.details));
  }
}

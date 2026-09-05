import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from './api-response.util';

/**
 * Structural subset of the HTTP response we need. Typed this way so the core
 * library does not take a hard dependency on an HTTP driver's typings.
 */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * Makes the `ApiResponse` failure envelope real: every error leaves the API in
 * the shape `@clinic/contracts` promises, so `ApiClient` has exactly one error
 * path to handle.
 *
 * Registered globally in `apps/api/src/main.ts`.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      response
        .status(status)
        .json(
          apiFailure(
            codeFromStatus(status),
            typeof body === 'string' ? body : exception.message,
            typeof body === 'object' ? body : undefined,
          ),
        );
      return;
    }

    // Unexpected: log the cause, but never leak internals to the caller.
    this.logger.error('Unhandled exception', exception as Error);

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(apiFailure('internal_error', 'Internal server error.'));
  }
}

function codeFromStatus(status: number): string {
  return (
    Object.entries(HttpStatus).find(([, value]) => value === status)?.[0] ??
    `http_${status}`
  )
    .toLowerCase()
    .replace(/\W+/g, '_');
}

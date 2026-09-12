import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import {
  NotificationsError,
  NotificationsErrorCode,
} from '../notifications.errors';

interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

@Catch(NotificationsError)
export class NotificationsExceptionFilter implements ExceptionFilter {
  catch(exception: NotificationsError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status =
      exception.code === NotificationsErrorCode.NotFound
        ? HttpStatus.NOT_FOUND
        : HttpStatus.INTERNAL_SERVER_ERROR;
    response
      .status(status)
      .json(apiFailure(exception.code, exception.message));
  }
}

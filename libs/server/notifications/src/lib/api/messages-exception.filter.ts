import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { MessagesError, MessagesErrorCode } from '../messages.errors';

interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

const STATUS: Record<MessagesErrorCode, number> = {
  [MessagesErrorCode.ThreadNotFound]: HttpStatus.NOT_FOUND,
  [MessagesErrorCode.ThreadClosed]: HttpStatus.CONFLICT,
  [MessagesErrorCode.NoDoctorAvailable]: HttpStatus.CONFLICT,
  [MessagesErrorCode.UrgentCaseNotFound]: HttpStatus.NOT_FOUND,
  [MessagesErrorCode.UrgentCaseAlreadyDecided]: HttpStatus.CONFLICT,
  [MessagesErrorCode.InvalidParticipant]: HttpStatus.BAD_REQUEST,
};

@Catch(MessagesError)
export class MessagesExceptionFilter implements ExceptionFilter {
  catch(exception: MessagesError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    response
      .status(STATUS[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR)
      .json(apiFailure(exception.code, exception.message));
  }
}

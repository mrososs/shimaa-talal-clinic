import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { PaymentsError, PaymentsErrorCode } from '../payments.errors';

interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}
const STATUS: Record<PaymentsErrorCode, number> = {
  [PaymentsErrorCode.NotFound]: HttpStatus.NOT_FOUND,
  [PaymentsErrorCode.InvalidTransition]: HttpStatus.CONFLICT,
  [PaymentsErrorCode.InvalidReceipt]: HttpStatus.BAD_REQUEST,
  [PaymentsErrorCode.InstapayUnavailable]: HttpStatus.CONFLICT,
  [PaymentsErrorCode.StorageFailed]: HttpStatus.SERVICE_UNAVAILABLE,
};
@Catch(PaymentsError)
export class PaymentsExceptionFilter implements ExceptionFilter {
  catch(exception: PaymentsError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<JsonResponse>()
      .status(STATUS[exception.code])
      .json(apiFailure(exception.code, exception.message));
  }
}

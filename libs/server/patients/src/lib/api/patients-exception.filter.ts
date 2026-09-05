import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { apiFailure } from '@clinic/server-core';
import { PatientsError, PatientsErrorCode } from '../patients.errors';

/** Structural subset of the response, so this file needs no HTTP driver types. */
interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

/**
 * Turns a domain rule violation into an HTTP answer.
 *
 * The domain's own code becomes the API's error code — `guardian_phone_taken`,
 * not `conflict`. A client deciding whether to offer "open the existing family"
 * needs to know *which* conflict occurred, and a status alone cannot say.
 *
 * The mapping lives here, in the domain's API layer, rather than in
 * `apps/api`: which rule deserves which status is domain knowledge, and the
 * composition root should not have to learn it.
 */
const STATUS_BY_CODE: Record<PatientsErrorCode, number> = {
  [PatientsErrorCode.GuardianPhoneTaken]: HttpStatus.CONFLICT,
  [PatientsErrorCode.GuardianNotFound]: HttpStatus.NOT_FOUND,
  [PatientsErrorCode.InvalidPhone]: HttpStatus.BAD_REQUEST,

  [PatientsErrorCode.ChildNotFound]: HttpStatus.NOT_FOUND,
  [PatientsErrorCode.PrimaryGuardianTaken]: HttpStatus.CONFLICT,

  [PatientsErrorCode.GuardianAlreadyClaimed]: HttpStatus.CONFLICT,
  [PatientsErrorCode.AuthUserAlreadyLinked]: HttpStatus.CONFLICT,

  [PatientsErrorCode.ClaimCodeInvalid]: HttpStatus.BAD_REQUEST,
  [PatientsErrorCode.ClaimCodeExpired]: HttpStatus.BAD_REQUEST,
  // Rate limiting, so the status that means it.
  [PatientsErrorCode.ClaimCodeLocked]: HttpStatus.TOO_MANY_REQUESTS,
};

@Catch(PatientsError)
export class PatientsExceptionFilter implements ExceptionFilter {
  catch(exception: PatientsError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const status =
      STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    // The message is written for a person and carries no identifiers; `details`
    // is deliberately omitted, since a domain error has nothing to add that the
    // code does not already say.
    response.status(status).json(apiFailure(exception.code, exception.message));
  }
}

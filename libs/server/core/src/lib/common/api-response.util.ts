import type { ApiFailure, ApiSuccess } from '@clinic/contracts';

/** Wraps a payload in the shared success envelope. */
export function apiSuccess<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

/** Builds the shared failure envelope. */
export function apiFailure(
  code: string,
  message: string,
  details?: unknown,
): ApiFailure {
  return { success: false, error: { code, message, details } };
}

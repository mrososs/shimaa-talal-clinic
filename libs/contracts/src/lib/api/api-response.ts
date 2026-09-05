/**
 * The single response envelope every business endpoint of the API returns.
 *
 * Clients therefore only ever branch on `success`, and error handling does not
 * have to be re-invented per feature.
 *
 * The `/health` endpoint is deliberately exempt: infrastructure probes expect a
 * flat body, so it returns its payload unwrapped.
 */

export interface ApiErrorBody {
  /** Stable, machine-readable code. Never localise this. */
  code: string;
  /** Human-readable message. Safe to show in logs, not necessarily to users. */
  message: string;
  /** Optional structured detail, e.g. field-level validation failures. */
  details?: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Narrows an `ApiResponse<T>` to its success branch. */
export function isApiSuccess<T>(
  response: ApiResponse<T>,
): response is ApiSuccess<T> {
  return response.success;
}

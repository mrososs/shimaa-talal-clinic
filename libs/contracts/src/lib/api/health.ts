/**
 * Payload of `GET /api/v1/health`.
 *
 * This exists to prove the wiring — client → API → configuration — not to
 * describe any clinic behaviour.
 */
export interface HealthCheckResult {
  status: 'ok';
  service: string;
  /** ISO-8601 timestamp produced by the API. */
  timestamp: string;
}

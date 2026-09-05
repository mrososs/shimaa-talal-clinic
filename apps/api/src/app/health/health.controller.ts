import { Controller, Get } from '@nestjs/common';
import type { HealthCheckResult } from '@clinic/contracts';

/**
 * `GET /api/v1/health`
 *
 * Infrastructure validation, not a product feature: it proves the global
 * prefix, URI versioning, configuration loading and the deployment itself are
 * all wired correctly.
 *
 * It deliberately returns a *flat* body rather than the `ApiResponse` envelope
 * that business endpoints use — probes and load balancers expect a plain
 * `{"status":"ok"}`.
 */
@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  check(): HealthCheckResult {
    return {
      status: 'ok',
      service: 'clinic-api',
      timestamp: new Date().toISOString(),
    };
  }
}

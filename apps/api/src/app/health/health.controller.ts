import { Controller, Get } from '@nestjs/common';
import type { HealthCheckResult } from '@clinic/contracts';
import { Public } from '@clinic/server-core';

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
  // The one route that opts out of authentication. A probe cannot hold a
  // token, and a health check that needs one cannot report that auth is down.
  @Public()
  @Get()
  check(): HealthCheckResult {
    return {
      status: 'ok',
      service: 'clinic-api',
      timestamp: new Date().toISOString(),
    };
  }
}

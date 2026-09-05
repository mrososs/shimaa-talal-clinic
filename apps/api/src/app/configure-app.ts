import {
  ValidationPipe,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import { API_PREFIX, API_VERSION } from '@clinic/contracts';
import { ApiExceptionFilter } from '@clinic/server-core';

/**
 * Everything the HTTP layer needs beyond the module graph.
 *
 * Extracted from `main.ts` so a test can stand up the same application the
 * deployment does. A security test that configured its own pipeline would be
 * asserting against a copy, and the copy is exactly where a difference would
 * hide.
 *
 * Composition only, as this application is allowed to contain. CORS and the
 * listening port stay in `main.ts`: they are deployment concerns, and a test
 * has no use for either.
 */
export function configureApp(app: INestApplication): void {
  // Routes resolve as /api/v1/<path>. Both values come from @clinic/contracts,
  // so the frontends cannot drift from the server.
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Every error leaves the API in the shared ApiResponse failure shape.
  app.useGlobalFilters(new ApiExceptionFilter());
}

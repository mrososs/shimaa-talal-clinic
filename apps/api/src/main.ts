import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX, API_VERSION } from '@clinic/contracts';
import { ServerConfigService } from '@clinic/server-core';
import { AppModule } from './app/app.module';
import { configureApp } from './app/configure-app';

/**
 * Bootstrap for the clinic API.
 *
 * Infrastructure only — prefix, versioning, CORS, validation, error shape.
 * Business wiring belongs to the domain modules.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Configuration is validated at module init; if the environment is wrong the
  // process has already failed by this point, with an actionable message.
  const config = app.get(ServerConfigService);

  // Prefix, versioning, validation and the error envelope. Shared with the
  // test that asserts the security behaviour, so both exercise one pipeline.
  configureApp(app);

  app.enableCors({
    origin: config.corsOrigins === '*' ? true : config.corsOrigins,
    credentials: true,
  });

  // Without this, onModuleDestroy never runs on SIGTERM and the pg pool is
  // torn down by process exit rather than closed cleanly.
  app.enableShutdownHooks();

  // No host: Node binds every interface, which is what a container platform
  // routes to. Naming localhost here would only be true on a developer's
  // machine, and a deployment log that says it is serving localhost is a
  // sentence somebody will eventually try to open.
  await app.listen(config.port);

  Logger.log(
    `Clinic API ready on port ${config.port}, serving /${API_PREFIX}/v${API_VERSION}`,
    'Bootstrap',
  );
}

void bootstrap();

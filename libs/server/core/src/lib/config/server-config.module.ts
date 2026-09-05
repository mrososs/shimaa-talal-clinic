import { Global, Module } from '@nestjs/common';
import { ConfigModule, registerAs } from '@nestjs/config';
import { SERVER_CONFIG_NAMESPACE, loadServerConfig } from './server-config';
import { ServerConfigService } from './server-config.service';

/**
 * `.env` files are read relative to the process working directory, which is the
 * workspace root for every Nx target. `.env.local` wins over `.env`.
 */
const ENV_FILE_PATHS = ['.env.local', '.env'];

export const serverConfigFactory = registerAs(SERVER_CONFIG_NAMESPACE, () =>
  loadServerConfig(),
);

/**
 * Global so that domain modules can inject `ServerConfigService` without each
 * re-importing a configuration module.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ENV_FILE_PATHS,
      load: [serverConfigFactory],
    }),
  ],
  providers: [ServerConfigService],
  exports: [ServerConfigService],
})
export class ServerConfigModule {}

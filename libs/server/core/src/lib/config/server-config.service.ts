import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SERVER_CONFIG_NAMESPACE,
  ServerConfigError,
  type DatabaseConfig,
  type NodeEnvironment,
  type ServerConfig,
  type SupabaseServerConfig,
} from './server-config';

/**
 * Typed, injectable access to the validated environment.
 *
 * Inject this — not `ConfigService`, and never `process.env`.
 */
@Injectable()
export class ServerConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): NodeEnvironment {
    return this.values.nodeEnv;
  }

  get isProduction(): boolean {
    return this.values.nodeEnv === 'production';
  }

  get port(): number {
    return this.values.port;
  }

  get corsOrigins(): string[] | '*' {
    return this.values.corsOrigins;
  }

  /** Supabase's own APIs: Auth, Storage, Realtime later. Not business data. */
  get supabase(): SupabaseServerConfig {
    return this.values.supabase;
  }

  /** Direct PostgreSQL access for transactional business data. */
  get database(): DatabaseConfig {
    return this.values.database;
  }

  private get values(): ServerConfig {
    const values = this.config.get<ServerConfig>(SERVER_CONFIG_NAMESPACE);

    if (!values) {
      throw new ServerConfigError(
        'Server configuration was not loaded. Is ServerCoreModule imported?',
      );
    }

    return values;
  }
}

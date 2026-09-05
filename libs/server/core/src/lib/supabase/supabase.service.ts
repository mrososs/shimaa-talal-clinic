import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ServerConfigService } from '../config/server-config.service';

/**
 * The single server-side integration point with Supabase's own APIs.
 *
 * **Scope.** This service is for things only Supabase can do: Auth
 * administration and token verification, Storage, and Realtime later.
 *
 * It is deliberately **not** the way domain modules read and write business
 * data. That goes through `DatabaseService`, because `supabase-js` speaks
 * PostgREST over HTTP and cannot group statements into one
 * application-controlled transaction. See docs/database.md.
 *
 * Domain modules inject this service; they never call `createClient`
 * themselves, so credentials and client options stay in one auditable place.
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private adminClient: SupabaseClient | null = null;

  constructor(private readonly config: ServerConfigService) {}

  onModuleInit(): void {
    const { url, secretKey } = this.config.supabase;

    this.adminClient = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    this.logger.log(`Supabase client ready for ${safeHost(url)}`);
  }

  /**
   * Client built with the Supabase **secret key** (`sb_secret_...`).
   *
   * **Bypasses Row Level Security.** Use it for administrative Supabase
   * operations - verifying a token, managing a user, writing to a private
   * storage bucket - where the API has already decided the caller is allowed.
   */
  get admin(): SupabaseClient {
    if (!this.adminClient) {
      throw new Error(
        'SupabaseService was used before initialisation. Import ServerCoreModule.',
      );
    }

    return this.adminClient;
  }

  /**
   * A client scoped to an end user's access token, built with the
   * **publishable key** (`sb_publishable_...`), so Row Level Security applies
   * exactly as it would for a direct call from that user's browser.
   *
   * Intended for Storage and Realtime on behalf of a signed-in user. Business
   * data belongs to `DatabaseService`.
   */
  forUser(accessToken: string): SupabaseClient {
    const { url, publishableKey } = this.config.supabase;

    if (!publishableKey) {
      throw new Error(
        'SUPABASE_PUBLISHABLE_KEY is required to build a user-scoped client.',
      );
    }

    return createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }
}

/** Logs the host only - the URL can carry a project ref we do not need in logs. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '<invalid SUPABASE_URL>';
  }
}

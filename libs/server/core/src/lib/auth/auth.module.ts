import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { SupabaseTokenVerifier } from './supabase-token.verifier';
import { TOKEN_VERIFIER } from './token-verifier';

/**
 * Provides token verification to the rest of the backend.
 *
 * It deliberately does not register `SupabaseAuthGuard` as a global guard.
 * `ServerCoreModule` is imported by every domain module, and an APP_GUARD
 * provided from here would be registered once per import. Registration
 * happens once, at the composition root in `apps/api`.
 */
@Module({
  imports: [SupabaseModule],
  providers: [{ provide: TOKEN_VERIFIER, useClass: SupabaseTokenVerifier }],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}

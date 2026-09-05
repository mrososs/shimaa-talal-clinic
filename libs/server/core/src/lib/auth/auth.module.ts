import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { SupabaseTokenVerifier } from './supabase-token.verifier';
import { TOKEN_VERIFIER } from './token-verifier';

/**
 * Provides token verification to the rest of the backend.
 *
 * It intentionally registers no guard: Phase 2 decides which routes are
 * protected and how roles are resolved.
 */
@Module({
  imports: [SupabaseModule],
  providers: [{ provide: TOKEN_VERIFIER, useClass: SupabaseTokenVerifier }],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}

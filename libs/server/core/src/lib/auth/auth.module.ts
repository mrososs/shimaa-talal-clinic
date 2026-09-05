import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CachedTokenVerifier } from './cached-token.verifier';
import { SupabaseTokenVerifier } from './supabase-token.verifier';
import { TOKEN_VERIFIER } from './token-verifier';

/**
 * Provides token verification to the rest of the backend.
 *
 * `TOKEN_VERIFIER` resolves to a cache wrapped around the Supabase verifier.
 * Consumers see one interface and never know which is answering — which is the
 * point of the seam: the verification strategy can change again (local JWKS
 * verification is the likely next step) without any caller being touched.
 *
 * It deliberately does not register `SupabaseAuthGuard` as a global guard.
 * `ServerCoreModule` is imported by every domain module, and an APP_GUARD
 * provided from here would be registered once per import. Registration happens
 * once, at the composition root in `apps/api`.
 */
@Module({
  imports: [SupabaseModule],
  providers: [
    SupabaseTokenVerifier,
    {
      provide: TOKEN_VERIFIER,
      useFactory: (inner: SupabaseTokenVerifier) =>
        new CachedTokenVerifier(inner),
      inject: [SupabaseTokenVerifier],
    },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}

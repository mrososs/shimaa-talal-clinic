import { Test } from '@nestjs/testing';
import { AuthModule } from './auth.module';
import { CachedTokenVerifier } from './cached-token.verifier';
import { SupabaseService } from '../supabase/supabase.service';
import { SupabaseTokenVerifier } from './supabase-token.verifier';
import { TOKEN_VERIFIER } from './token-verifier';

/**
 * A wiring test, and it earns its place: if the factory in AuthModule is ever
 * simplified back to `useClass: SupabaseTokenVerifier`, nothing fails, no test
 * breaks, and the API quietly resumes making one HTTP call to Supabase for
 * every single request. That regression is invisible except in a latency graph.
 */
describe('AuthModule', () => {
  async function resolveTokenVerifier() {
    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      // The real client reads configuration and calls createClient on init.
      // Nothing here needs it — only the shape of the provider graph.
      .overrideProvider(SupabaseService)
      .useValue({})
      .compile();

    return moduleRef.get(TOKEN_VERIFIER);
  }

  it('resolves TOKEN_VERIFIER to a cache, not to the raw Supabase verifier', async () => {
    const verifier = await resolveTokenVerifier();

    expect(verifier).toBeInstanceOf(CachedTokenVerifier);
    expect(verifier).not.toBeInstanceOf(SupabaseTokenVerifier);
  });

  it('wraps the Supabase verifier rather than replacing it', async () => {
    const verifier = (await resolveTokenVerifier()) as CachedTokenVerifier;
    const inner = (verifier as unknown as { inner: unknown }).inner;

    expect(inner).toBeInstanceOf(SupabaseTokenVerifier);
  });
});

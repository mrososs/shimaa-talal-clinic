import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthenticatedUser } from './authenticated-user';
import type { TokenVerifier } from './token-verifier';

/**
 * Verifies a Supabase access token by asking Supabase Auth who it belongs to.
 *
 * One network round-trip per verification, which is why nothing injects this
 * class directly. `AuthModule` binds `TOKEN_VERIFIER` to a `CachedTokenVerifier`
 * wrapped around it, and local JWKS verification can replace the inner call the
 * same way — without any caller changing.
 */
@Injectable()
export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly supabase: SupabaseService) {}

  async verify(accessToken: string): Promise<AuthenticatedUser | null> {
    if (!accessToken) {
      return null;
    }

    const { data, error } = await this.supabase.admin.auth.getUser(accessToken);

    if (error || !data.user) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email ?? null,
      roles: [],
    };
  }
}

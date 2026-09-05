import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { AuthenticatedUser } from './authenticated-user';
import type { TokenVerifier } from './token-verifier';

/**
 * Verifies a Supabase access token by asking Supabase Auth who it belongs to.
 *
 * Nothing enforces this yet: no guard is registered, and no route is protected.
 * Wiring it into a guard is a Phase 2 task, deliberately left undone so the
 * foundation ships without a half-built auth flow.
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

import type { UserRole } from '@clinic/contracts';

/**
 * Who the API believes is making the current request, once a Supabase access
 * token has been verified.
 */
export interface AuthenticatedUser {
  /** Supabase `auth.users.id`. */
  id: string;
  email: string | null;
  /**
   * Roles are not resolved yet — role storage arrives with the patients domain
   * in Phase 2, so this is currently always empty.
   */
  roles: UserRole[];
}

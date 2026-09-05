/**
 * Who a signed-in user is, from the platform's point of view.
 *
 * Role *assignment* and *authorisation* are server concerns and are not
 * implemented yet; this is only the shared vocabulary.
 */
export const UserRole = {
  /** A parent or caregiver who books on behalf of themselves and children. */
  Guardian: 'guardian',
  Reception: 'reception',
  Doctor: 'doctor',
  Admin: 'admin',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

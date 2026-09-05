import { describe, expect, it } from 'vitest';
import { ClinicMemberRole } from '@clinic/contracts';
import { navigationFor } from './navigation';

/**
 * The sidebar is presentation, but a link a role can see and then be refused
 * is a bug the API would report as a 403 the user cannot explain.
 */
describe('dashboard navigation', () => {
  it('shows nothing to an account with no membership', () => {
    expect(navigationFor(null)).toEqual([]);
  });

  it('shows the shared screens to every role', () => {
    for (const role of [
      ClinicMemberRole.Doctor,
      ClinicMemberRole.Reception,
      ClinicMemberRole.Admin,
    ]) {
      expect(navigationFor(role).map((link) => link.name)).toContain('overview');
    }
  });

  it('never offers a link a role is not allowed to open', () => {
    for (const role of [
      ClinicMemberRole.Doctor,
      ClinicMemberRole.Reception,
      ClinicMemberRole.Admin,
    ]) {
      for (const link of navigationFor(role)) {
        expect(link.roles === undefined || link.roles.includes(role)).toBe(true);
      }
    }
  });
});

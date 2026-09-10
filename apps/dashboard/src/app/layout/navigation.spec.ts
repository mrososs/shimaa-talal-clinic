import { describe, expect, it } from 'vitest';
import { ClinicMemberRole } from '@clinic/contracts';
import { navigationFor, navigationSectionsFor } from './navigation';

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
      expect(navigationFor(role).map((link) => link.name)).toContain(
        'overview',
      );
    }
  });

  it('never offers a link a role is not allowed to open', () => {
    for (const role of [
      ClinicMemberRole.Doctor,
      ClinicMemberRole.Reception,
      ClinicMemberRole.Admin,
    ]) {
      for (const link of navigationFor(role)) {
        expect(link.roles === undefined || link.roles.includes(role)).toBe(
          true,
        );
      }
    }
  });

  it('groups only the links visible to the current role', () => {
    const reception = navigationSectionsFor(ClinicMemberRole.Reception);
    const doctor = navigationSectionsFor(ClinicMemberRole.Doctor);

    expect(reception).toHaveLength(2);
    expect(reception[0]?.label).toBe('العمليات اليومية');
    expect(reception[0]?.links.map((link) => link.name)).toContain(
      'reception-booking',
    );
    expect(doctor[0]?.links.map((link) => link.name)).not.toContain(
      'reception-booking',
    );
    expect(doctor[1]?.links.map((link) => link.name)).toContain('patients');
    expect(doctor[1]?.links.map((link) => link.name)).toContain('settings');
    expect(reception[1]?.links.map((link) => link.name)).not.toContain(
      'settings',
    );
  });
});

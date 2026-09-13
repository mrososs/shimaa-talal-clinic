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

    // Reception works the desk only, so the records group is empty for them and
    // the section disappears rather than rendering an empty heading.
    expect(reception.map((section) => section.id)).toEqual(['daily']);
    expect(reception[0]?.label).toBe('العمليات اليومية');
    expect(reception[0]?.links.map((link) => link.name)).toContain(
      'reception-booking',
    );
    expect(doctor[0]?.links.map((link) => link.name)).not.toContain(
      'reception-booking',
    );
    expect(doctor[1]?.links.map((link) => link.name)).toContain('patients');
    expect(doctor[1]?.links.map((link) => link.name)).toContain('settings');
  });

  it('keeps the clinic records out of reception entirely', () => {
    const reception = navigationFor(ClinicMemberRole.Reception).map(
      (link) => link.name,
    );

    expect(reception).toEqual([
      'overview',
      'appointments',
      'queue',
      'messages',
      'reception-booking',
    ]);
    for (const name of ['patients', 'payments', 'reports', 'settings']) {
      expect(reception).not.toContain(name);
    }
  });
});

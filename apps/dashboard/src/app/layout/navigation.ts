import { ClinicMemberRole } from '@clinic/contracts';

/**
 * What appears in the sidebar, per role.
 *
 * Presentation only. A doctor not seeing a reception link is a convenience —
 * the API refuses the request whether or not the link was rendered, and that
 * is the copy that carries the rule. Keeping the two lists in one file makes
 * it obvious when they disagree.
 */
export interface NavigationLink {
  name: string;
  label: string;
  roles?: readonly ClinicMemberRole[];
}

export const NAVIGATION: readonly NavigationLink[] = [
  { name: 'overview', label: 'اليوم' },
  { name: 'appointments', label: 'المواعيد' },
  {
    name: 'reception-booking',
    label: 'حجز جديد',
    // Booking on a family's behalf is reception's job at the desk. The doctor
    // can still approve, cancel and reschedule from the appointments screen.
    roles: [ClinicMemberRole.Reception, ClinicMemberRole.Admin],
  },
];

export function navigationFor(
  role: ClinicMemberRole | null,
): NavigationLink[] {
  if (role === null) return [];
  return NAVIGATION.filter(
    (link) => link.roles === undefined || link.roles.includes(role),
  );
}

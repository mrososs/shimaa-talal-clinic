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
  icon: NavigationIcon;
  group: NavigationGroup;
  roles?: readonly ClinicMemberRole[];
}

export type NavigationIcon =
  | 'overview'
  | 'appointments'
  | 'queue'
  | 'booking'
  | 'patients'
  | 'messages'
  | 'payments'
  | 'reports'
  | 'settings';

export type NavigationGroup = 'daily' | 'records';

export interface NavigationSection {
  id: NavigationGroup;
  label: string;
  links: NavigationLink[];
}

export const NAVIGATION_GROUPS: Readonly<Record<NavigationGroup, string>> = {
  daily: 'العمليات اليومية',
  records: 'ملفات العيادة',
};

export const NAVIGATION: readonly NavigationLink[] = [
  { name: 'overview', label: 'نظرة عامة', icon: 'overview', group: 'daily' },
  {
    name: 'appointments',
    label: 'المواعيد',
    icon: 'appointments',
    group: 'daily',
  },
  // Every role runs the queue. What each may *do* with it differs, and the API
  // enforces that difference on each command rather than by hiding the board.
  {
    name: 'queue',
    label: 'الطابور المباشر',
    icon: 'queue',
    group: 'daily',
  },
  {
    name: 'messages',
    label: 'الرسائل والحالات العاجلة',
    icon: 'messages',
    group: 'daily',
  },
  {
    name: 'reception-booking',
    label: 'حجز جديد',
    icon: 'booking',
    group: 'daily',
    // Booking on a family's behalf is reception's job at the desk. The doctor
    // can still approve, cancel and reschedule from the appointments screen.
    roles: [ClinicMemberRole.Reception, ClinicMemberRole.Admin],
  },
  {
    name: 'patients',
    label: 'المرضى والعائلات',
    icon: 'patients',
    group: 'records',
  },
  { name: 'payments', label: 'المدفوعات', icon: 'payments', group: 'records' },
  { name: 'reports', label: 'التقارير', icon: 'reports', group: 'records' },
  {
    name: 'settings', label: 'الإعدادات والفريق', icon: 'settings', group: 'records',
    roles: [ClinicMemberRole.Doctor, ClinicMemberRole.Admin],
  },
];

export function navigationFor(role: ClinicMemberRole | null): NavigationLink[] {
  if (role === null) return [];
  return NAVIGATION.filter(
    (link) => link.roles === undefined || link.roles.includes(role),
  );
}

/** Group visible links without making the sidebar know the role rules. */
export function navigationSectionsFor(
  role: ClinicMemberRole | null,
): NavigationSection[] {
  const links = navigationFor(role);
  return (Object.keys(NAVIGATION_GROUPS) as NavigationGroup[])
    .map((id) => ({
      id,
      label: NAVIGATION_GROUPS[id],
      links: links.filter((link) => link.group === id),
    }))
    .filter((section) => section.links.length > 0);
}

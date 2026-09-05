/**
 * Which half of the clinic day a session covers.
 *
 * A pediatric clinic runs a morning and an evening block with a gap between
 * them, so a "day" is not one continuous run of appointments. Two values is the
 * whole model — there is no need for named shifts or arbitrary blocks.
 */
export const ClinicSessionKind = {
  Morning: 'morning',
  Evening: 'evening',
} as const;

export type ClinicSessionKind =
  (typeof ClinicSessionKind)[keyof typeof ClinicSessionKind];

/**
 * How a guardian is related to a child.
 *
 * A child has *many* guardians, not one: mother and father may both hold
 * accounts, and a grandparent may be the person who actually brings them in.
 * That is why this lives on the `guardian_children` link rather than on the
 * child, and why the link table exists at all.
 */
export const GuardianRelationship = {
  Mother: 'mother',
  Father: 'father',
  Grandparent: 'grandparent',
  Other: 'other',
} as const;

export type GuardianRelationship =
  (typeof GuardianRelationship)[keyof typeof GuardianRelationship];

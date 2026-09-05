/**
 * `@clinic/server-patients` — guardian and child identity, and account claiming.
 *
 * Intent-shaped services only. Row shapes, SQL and the column projections stay
 * private: a caller that could reach them would couple itself to the schema,
 * and the point of a domain boundary is that it can change its storage without
 * a workflow noticing.
 */
export * from './lib/patients.module';

export { GuardianService } from './lib/guardian.service';
export type {
  CreateGuardianInput,
  GuardianClaimMethod,
  GuardianSearchInput,
  UpdateGuardianInput,
} from './lib/guardian.service';

export { ChildService } from './lib/child.service';
export type {
  CreateChildInput,
  LinkChildInput,
  UpdateChildInput,
} from './lib/child.service';

export { GuardianOwnershipService } from './lib/guardian-ownership.service';

export { ClaimCodeService } from './lib/claim-code.service';
export type { ClaimInput } from './lib/claim-code.service';
export {
  CLAIM_CODE_MAX_ATTEMPTS,
  CLAIM_CODE_TTL_MINUTES,
} from './lib/claim-code.service';

export { PatientsError, PatientsErrorCode } from './lib/patients.errors';

import { Module } from '@nestjs/common';
import { GUARDIAN_RESOLVER, ServerCoreModule } from '@clinic/server-core';
import { ChildService } from './child.service';
import { ClaimCodeService } from './claim-code.service';
import { GuardianOwnershipService } from './guardian-ownership.service';
import { GuardianService } from './guardian.service';
import { PatientsGuardianResolver } from './patients-guardian.resolver';

/**
 * Patients domain boundary.
 *
 * Owns guardian and child identity, the relationship between them, and the
 * assisted account claim that links a family the clinic already knows to an
 * app account.
 *
 * It also answers `GUARDIAN_RESOLVER`, the port `server-core` declares so the
 * authorisation layer can ask who a caller is without a shared library
 * depending on a domain. Binding it here rather than in `apps/api` keeps the
 * implementation choice inside the domain that owns it; the composition root
 * only has to import this module.
 *
 * No controllers yet — those arrive with the parent and staff APIs.
 *
 * Owns no clinical data. Diagnoses, prescriptions, allergies, vaccinations and
 * growth are a medical record this platform does not hold.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [],
  providers: [
    GuardianService,
    ChildService,
    GuardianOwnershipService,
    ClaimCodeService,
    PatientsGuardianResolver,
    { provide: GUARDIAN_RESOLVER, useExisting: PatientsGuardianResolver },
  ],
  exports: [
    GuardianService,
    ChildService,
    GuardianOwnershipService,
    ClaimCodeService,
    GUARDIAN_RESOLVER,
  ],
})
export class PatientsModule {}

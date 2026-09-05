import { Module } from '@nestjs/common';
import {
  CHILD_ACCESS_CHECKER,
  GUARDIAN_RESOLVER,
  ServerCoreModule,
} from '@clinic/server-core';
import { ClinicModule } from '@clinic/server-clinic';
import { ChildService } from './child.service';
import { PatientDirectoryService } from './patient-directory.service';
import { ClaimCodeService } from './claim-code.service';
import { GuardianOwnershipService } from './guardian-ownership.service';
import { GuardianService } from './guardian.service';
import {
  ClinicChildrenController,
  ClinicGuardiansController,
} from './api/clinic-guardians.controller';
import { MeController } from './api/me.controller';
import { PatientsChildAccessChecker } from './patients-child-access';
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
 * `MeController` is the parent-facing surface. The staff surface is separate,
 * because reception acts for other people's families and a parent acts only for
 * their own — different authorisation, different shape, different controller.
 *
 * Owns no clinical data. Diagnoses, prescriptions, allergies, vaccinations and
 * growth are a medical record this platform does not hold.
 */
@Module({
  // ClinicModule is scope:shared, so a domain may depend on it. The parent
  // endpoints need the clinic's phone region and policy, and reading another
  // library's table directly is the coupling the boundaries exist to prevent.
  imports: [ServerCoreModule, ClinicModule],
  controllers: [
    MeController,
    ClinicGuardiansController,
    ClinicChildrenController,
  ],
  providers: [
    GuardianService,
    ChildService,
    PatientDirectoryService,
    GuardianOwnershipService,
    ClaimCodeService,
    PatientsGuardianResolver,
    { provide: GUARDIAN_RESOLVER, useExisting: PatientsGuardianResolver },
    // Booking asks whether a child is this family's before it holds a seat.
    PatientsChildAccessChecker,
    { provide: CHILD_ACCESS_CHECKER, useExisting: PatientsChildAccessChecker },
  ],
  exports: [
    GuardianService,
    ChildService,
    PatientDirectoryService,
    GuardianOwnershipService,
    ClaimCodeService,
    GUARDIAN_RESOLVER,
    CHILD_ACCESS_CHECKER,
    // Exported as a class as well as behind its token, so the composition root
    // can publish it to the domains that may not import this module.
    PatientsChildAccessChecker,
  ],
})
export class PatientsModule {}

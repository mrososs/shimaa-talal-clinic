import { Injectable } from '@nestjs/common';
import type { ChildAccessChecker } from '@clinic/server-core';
import { GuardianOwnershipService } from './guardian-ownership.service';

/**
 * Patients' answer to `CHILD_ACCESS_CHECKER`.
 *
 * A thin adapter, deliberately: the rule already exists in
 * `GuardianOwnershipService`, and the point of the port is that other domains
 * ask *this* implementation rather than writing their own version of "owns".
 */
@Injectable()
export class PatientsChildAccessChecker implements ChildAccessChecker {
  constructor(private readonly ownership: GuardianOwnershipService) {}

  canGuardianAccessChild(
    clinicId: string,
    guardianId: string,
    childId: string,
  ): Promise<boolean> {
    return this.ownership.canAccessChild(clinicId, guardianId, childId);
  }
}

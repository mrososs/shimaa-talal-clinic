import { Injectable } from '@nestjs/common';
import type { ChildAccessChecker } from '@clinic/server-core';
import { GuardianOwnershipService } from './guardian-ownership.service';
import { ChildService } from './child.service';

/**
 * Patients' answer to `CHILD_ACCESS_CHECKER`.
 *
 * A thin adapter, deliberately: the rule already exists in
 * `GuardianOwnershipService`, and the point of the port is that other domains
 * ask *this* implementation rather than writing their own version of "owns".
 */
@Injectable()
export class PatientsChildAccessChecker implements ChildAccessChecker {
  constructor(
    private readonly ownership: GuardianOwnershipService,
    private readonly children: ChildService,
  ) {}

  async childExistsInClinic(
    clinicId: string,
    childId: string,
  ): Promise<boolean> {
    return (await this.children.findById(clinicId, childId)) !== null;
  }

  canGuardianAccessChild(
    clinicId: string,
    guardianId: string,
    childId: string,
  ): Promise<boolean> {
    return this.ownership.canAccessChild(clinicId, guardianId, childId);
  }
}

import { Injectable } from '@nestjs/common';
import type { GuardianContext, GuardianResolver } from '@clinic/server-core';
import { GuardianService } from './guardian.service';

/**
 * The Patients-domain answer to `GUARDIAN_RESOLVER`.
 *
 * `server-core` declares the port because the authorisation layer has to ask
 * who a caller is, but `scope:shared` may not reach into a domain to find out.
 * This is the implementation on the other side of that inversion.
 *
 * It returns the minimum the guard needs — an id and a clinic — rather than the
 * full guardian. This runs on every guarded parent request, and it should not
 * make the database load a name and a phone number to answer a yes/no question.
 *
 * `null` is a normal result, not a failure: a signed-in user who has not yet
 * completed onboarding has no guardian, and `GET /me` exists to say so.
 */
@Injectable()
export class PatientsGuardianResolver implements GuardianResolver {
  constructor(private readonly guardians: GuardianService) {}

  async resolveByAuthUserId(
    authUserId: string,
  ): Promise<GuardianContext | null> {
    const guardian = await this.guardians.findByAuthUserId(authUserId);
    return guardian === null
      ? null
      : { id: guardian.id, clinicId: guardian.clinicId };
  }
}

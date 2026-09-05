import { Injectable } from '@nestjs/common';
import type {
  ClinicMemberContext,
  ClinicMemberResolver,
} from '@clinic/server-core';
import { ClinicMemberService } from './clinic-member.service';

/**
 * The clinic-domain answer to `CLINIC_MEMBER_RESOLVER`.
 *
 * `server-core` declares the port because the authorisation layer must ask who
 * a caller is, and `scope:shared` may not reach into a domain to find out. This
 * is the implementation on the other side of that inversion — the twin of
 * `PatientsGuardianResolver`.
 */
@Injectable()
export class ClinicMemberResolverImpl implements ClinicMemberResolver {
  constructor(private readonly members: ClinicMemberService) {}

  resolveByAuthUserId(authUserId: string): Promise<ClinicMemberContext | null> {
    return this.members.findByAuthUserId(authUserId);
  }
}

import {
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  CurrentMember,
  CurrentUser,
  Roles,
  type AuthenticatedUser,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { UserRole, type ClinicMeResponse } from '@clinic/contracts';
import { ClinicMemberService } from '../clinic-member.service';
import { ClinicService } from '../clinic.service';

/**
 * What the dashboard asks for first: who am I, and which clinic am I operating?
 *
 * The staff counterpart to `/me`, and deliberately not symmetrical with it.
 * `/me` answers for a signed-in user who is not yet a guardian, because
 * onboarding has to be reachable. There is no equivalent staff state — an
 * account either has a clinic membership or has no business on this dashboard —
 * so this route declares the three staff roles and lets the guard refuse
 * everyone else. A parent signing in here gets a 403, which is what the
 * "this account has no clinic access" screen renders.
 *
 * The clinic comes from the member the guard resolved, never from the request.
 */
@Controller({ path: 'clinic/me', version: '1' })
export class ClinicMeController {
  constructor(
    private readonly clinics: ClinicService,
    private readonly members: ClinicMemberService,
  ) {}

  @Roles(UserRole.Doctor, UserRole.Reception, UserRole.Admin)
  @Get()
  async me(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentMember() member: ClinicMemberContext,
  ): Promise<ClinicMeResponse> {
    const clinic = await this.clinics.findById(member.clinicId);
    if (clinic === null) {
      // The membership resolved but its clinic did not, which means the clinic
      // was deactivated while this account still points at it. That is an
      // operational state the dashboard should name, not a server fault.
      throw new NotFoundException('This clinic is not currently active.');
    }

    const profile = await this.members.findProfile(member.clinicId, member.id);
    if (profile === null) {
      // The guard resolved this member a moment ago, so a miss here is not a
      // client error — it means the row vanished mid-request.
      throw new InternalServerErrorException(
        'The clinic membership could not be read.',
      );
    }

    return {
      authUserId: user.id,
      email: user.email,
      clinic,
      member: profile,
    };
  }
}

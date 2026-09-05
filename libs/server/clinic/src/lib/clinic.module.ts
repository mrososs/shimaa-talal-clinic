import { Module } from '@nestjs/common';
import { CLINIC_MEMBER_RESOLVER, ServerCoreModule } from '@clinic/server-core';
import { ClinicMeController } from './api/clinic-me.controller';
import { ClinicMemberResolverImpl } from './clinic-member.resolver';
import { ClinicMemberService } from './clinic-member.service';
import { ClinicScheduleService } from './clinic-schedule.service';
import { ClinicSessionService } from './clinic-session.service';
import { ClinicService } from './clinic.service';

/**
 * Clinic boundary — tenancy, staff and (later) the operational day.
 *
 * Owns today:
 *   - clinics: the tenant root and the policy other domains read from it
 *   - clinic members: who may act for a clinic, and in what role
 *
 * It also answers `CLINIC_MEMBER_RESOLVER`, the port `server-core` declares so
 * the authorisation layer can ask who a caller is without a shared library
 * depending on a domain. Bound here rather than in `apps/api`, matching how
 * Patients binds the guardian side: the implementation choice stays inside the
 * domain that owns it.
 *
 * Schedules, closures and sessions are NOT here. They are the operational day,
 * a separate task, and nothing in this module anticipates them.
 *
 * `scope:shared` rather than a domain of its own because booking, queue and
 * patients all need to read a clinic, and a domain may only depend on itself
 * and shared code.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [ClinicMeController],
  providers: [
    ClinicService,
    ClinicMemberService,
    ClinicScheduleService,
    ClinicSessionService,
    ClinicMemberResolverImpl,
    { provide: CLINIC_MEMBER_RESOLVER, useExisting: ClinicMemberResolverImpl },
  ],
  exports: [
    ClinicService,
    ClinicMemberService,
    ClinicScheduleService,
    ClinicSessionService,
    CLINIC_MEMBER_RESOLVER,
  ],
})
export class ClinicModule {}

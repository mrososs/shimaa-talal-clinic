/**
 * `@clinic/server-clinic` — clinic tenancy and staff identity.
 *
 * Intent-shaped services only; row shapes and SQL stay private. Scheduling and
 * sessions are not part of this library yet.
 */
export * from './lib/clinic.module';
export { ClinicService } from './lib/clinic.service';
export { ClinicMemberService } from './lib/clinic-member.service';

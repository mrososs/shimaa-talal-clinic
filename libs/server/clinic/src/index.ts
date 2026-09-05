/**
 * `@clinic/server-clinic` — tenancy, staff, and the operational day.
 *
 * Intent-shaped services only; row shapes and SQL stay private.
 *
 * Booking and Queue both depend on this library and neither depends on the
 * other: a session carries the capacity Booking reads and the operational
 * state Queue writes.
 */
export * from './lib/clinic.module';
export { ClinicService } from './lib/clinic.service';
export { ClinicMemberService } from './lib/clinic-member.service';
export { ClinicScheduleService } from './lib/clinic-schedule.service';
export { ClinicSessionService } from './lib/clinic-session.service';
export { ClinicError, ClinicErrorCode } from './lib/clinic.errors';

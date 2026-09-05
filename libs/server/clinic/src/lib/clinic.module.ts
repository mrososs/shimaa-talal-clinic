import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';

/**
 * Clinic boundary — tenancy, staff and the operational day.
 *
 * Owns, when it is built:
 *   - clinics (the tenant root, and clinic-level policy: timezone, grace
 *     period, default consultation pace)
 *   - clinic members (doctor / reception / admin) and their roles
 *   - clinic schedules and closures (the weekly template)
 *   - clinic sessions (one concrete day-part: capacity, doctor presence,
 *     open/paused/closed, the daily ticket counter)
 *
 * Why this is `scope:shared` and not a domain of its own:
 *
 * Booking reads sessions to compute availability; Queue writes their
 * operational state; Patients needs clinic members to attribute staff actions.
 * Under the scope rules a domain may only depend on itself and `scope:shared`,
 * so a `scope:clinic` tag would need a new lint rule per consumer. This is
 * genuinely shared reference and tenancy data rather than a business engine,
 * so `scope:shared` is both the honest tag and the one that costs no rule
 * changes.
 *
 * It is `type:data-access`, so it may hold repositories and narrow state
 * transitions — but no product rules. "Is this appointment eligible for
 * check-in" belongs to booking, not here.
 *
 * Deliberately empty for now: the schema lands with the identity and
 * scheduling migrations. The module exists so the dependency direction
 * (api → clinic → server-core) is enforced before any code can get it wrong.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class ClinicModule {}

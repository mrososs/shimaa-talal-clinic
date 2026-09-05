import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';

/**
 * Booking domain boundary.
 *
 * Owns, when it is built:
 *   - appointments
 *   - appointment availability
 *   - the booking lifecycle (see `AppointmentStatus` in `@clinic/contracts`)
 *   - rescheduling and cancellation
 *
 * Deliberately empty. No controllers, no services, no persistence — the
 * Booking Engine is Phase 2. The module exists now so the dependency direction
 * (api → booking → server-core) is established and enforced from day one.
 *
 * Neutrality note: booking does not own payment or queue behaviour, and must
 * never depend on those domains. An appointment *has* a payment state and *may*
 * have a queue entry; it does not drive either. See
 * docs/cross-domain-orchestration.md.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class BookingModule {}

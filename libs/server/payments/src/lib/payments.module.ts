import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';

/**
 * Payments domain boundary.
 *
 * Owns, when it is built:
 *   - payment records and payment status
 *   - payment verification
 *   - refund state
 *   - the `PaymentProvider` implementation binding
 *
 * Deliberately empty, and deliberately provider-free: no `PAYMENT_PROVIDER`
 * implementation is registered, so nothing can accidentally start charging.
 *
 * Neutrality note: *when* a payment happens is clinic policy, not structure. It
 * may occur during booking, before arrival, at reception, or later. This domain
 * therefore never depends on Booking or Queue, and must not assume a payment is
 * tied to a queue position — see docs/cross-domain-orchestration.md.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class PaymentsModule {}

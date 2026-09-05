import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';

/**
 * Queue domain boundary.
 *
 * Owns, when it is built:
 *   - check-in and the live queue
 *   - serving order, missed turns and grace periods
 *   - emergency insertion and doctor delays
 *
 * Deliberately empty. No queue algorithm exists yet — that is Phase 2, and it
 * is the part most likely to need careful design, so nothing is prejudged here.
 *
 * Neutrality note: a queue entry does not presuppose an appointment. Walk-ins
 * and receptionist-inserted entries are first-class cases, so this domain must
 * never depend on Booking. Any workflow that links the two belongs to the
 * orchestration layer — see docs/cross-domain-orchestration.md.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class QueueModule {}

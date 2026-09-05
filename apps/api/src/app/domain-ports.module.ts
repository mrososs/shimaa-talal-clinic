import { Global, Module } from '@nestjs/common';
import { CHILD_ACCESS_CHECKER } from '@clinic/server-core';
import {
  PatientsChildAccessChecker,
  PatientsModule,
} from '@clinic/server-patients';

/**
 * Where a domain's answer is published to the domains that may not import it.
 *
 * Booking needs to know whether a child belongs to a guardian before it holds a
 * seat, and Queue will need the same. That fact lives in Patients, and no
 * domain may depend on another — so `server-core` declares the port, Patients
 * implements it, and the composition root wires the two together. Exactly the
 * inversion `TOKEN_VERIFIER` and `GUARDIAN_RESOLVER` already use.
 *
 * `@Global` is doing real work here, and it is narrow: it publishes one token,
 * not a module. Nest resolves a controller's dependencies from its own module
 * and that module's imports, so a binding made in `AppModule` would be
 * invisible inside `BookingModule` — and making `BookingModule` import
 * `PatientsModule` is the coupling the boundaries exist to prevent. Publishing
 * a single port globally is the smallest thing that works without breaking the
 * rule.
 *
 * Keep this list short. Every entry is a domain reaching into another's
 * knowledge, and the right answer for a *write* that spans domains is a
 * workflow, not a port.
 */
@Global()
@Module({
  imports: [PatientsModule],
  providers: [
    { provide: CHILD_ACCESS_CHECKER, useExisting: PatientsChildAccessChecker },
  ],
  exports: [CHILD_ACCESS_CHECKER],
})
export class DomainPortsModule {}

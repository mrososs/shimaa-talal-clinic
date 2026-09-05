import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';

/**
 * Patients domain boundary.
 *
 * Owns, when it is built:
 *   - guardian identity
 *   - children linked to a guardian
 *   - clinic patient records
 *   - account claiming (linking a walk-in record to a real account)
 *
 * Deliberately empty. This domain will also become the source of truth for
 * user roles, which is why `AuthenticatedUser.roles` is currently always empty.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class PatientsModule {}

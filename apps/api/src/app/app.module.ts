import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BookingModule } from '@clinic/server-booking';
import { ClinicModule } from '@clinic/server-clinic';
import { NotificationsModule } from '@clinic/server-notifications';
import { PatientsModule } from '@clinic/server-patients';
import { PaymentsModule } from '@clinic/server-payments';
import { QueueModule } from '@clinic/server-queue';
import { ServerCoreModule, SupabaseAuthGuard } from '@clinic/server-core';
import { WorkflowsModule } from '@clinic/server-workflows';
import { HealthModule } from './health/health.module';

/**
 * The application is intentionally thin: it composes modules and owns nothing.
 *
 * Every business capability lives in its own library under `libs/server/`.
 * Adding logic directly to `apps/api/src` is the failure mode this structure
 * exists to prevent.
 */
@Module({
  imports: [
    // Infrastructure: configuration, Supabase, token verification.
    ServerCoreModule,

    // Deployment health. Not a business capability.
    HealthModule,

    // Tenancy, staff and the operational day. Shared by several domains,
    // which is why it is scope:shared rather than a domain of its own.
    ClinicModule,

    // Business domains — all empty boundaries until Phase 2.
    BookingModule,
    QueueModule,
    PaymentsModule,
    PatientsModule,
    NotificationsModule,

    // Cross-domain orchestration. Sits above the domains; the domains stay
    // unaware of it and of each other.
    WorkflowsModule,
  ],
  providers: [
    // Authentication is on by default for every route in every module. A route
    // opts out with `@Public()`, which is one line in a diff — where forgetting
    // to protect a route would be an absence nobody notices.
    //
    // Registered here rather than in AuthModule because ServerCoreModule is
    // imported by every domain, and an APP_GUARD provided from a library module
    // is registered once per import.
    //
    // This answers "who is calling". What they may do is authorisation, and it
    // arrives with clinic membership and guardian ownership.
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },

    // `RolesGuard` belongs here too, immediately after the one above — global
    // guards run in registration order, and it reads the user that one sets.
    //
    // It is not registered yet because it depends on GUARDIAN_RESOLVER and
    // CLINIC_MEMBER_RESOLVER, which are ports with no implementation until the
    // patients and clinic domains land. Registering it now would fail at boot.
    // When those arrive, this becomes three entries: the two bindings and
    //   { provide: APP_GUARD, useClass: RolesGuard }
  ],
})
export class AppModule {}

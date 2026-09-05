import { Module } from '@nestjs/common';
import { BookingModule } from '@clinic/server-booking';
import { ClinicModule } from '@clinic/server-clinic';
import { NotificationsModule } from '@clinic/server-notifications';
import { PatientsModule } from '@clinic/server-patients';
import { PaymentsModule } from '@clinic/server-payments';
import { QueueModule } from '@clinic/server-queue';
import { ServerCoreModule } from '@clinic/server-core';
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
})
export class AppModule {}

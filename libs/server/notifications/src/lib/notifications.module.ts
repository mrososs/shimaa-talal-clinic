import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';

/**
 * Notifications domain boundary.
 *
 * Owns, when it is built:
 *   - WhatsApp, SMS and push delivery behind the `NotificationChannel` seam
 *   - message templating and delivery state
 *
 * Deliberately empty, and deliberately provider-free: no
 * `NOTIFICATION_CHANNELS` implementation is registered, so nothing can send
 * anything to a real patient by accident.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class NotificationsModule {}

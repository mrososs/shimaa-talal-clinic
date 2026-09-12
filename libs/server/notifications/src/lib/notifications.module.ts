import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';
import { MessagesController } from './api/messages.controller';
import { ParentMessagesController } from './api/parent-messages.controller';
import { ParentNotificationsController } from './api/parent-notifications.controller';
import { MessagesService } from './messages.service';
import { ParentNotificationsService } from './parent-notifications.service';

/**
 * Notifications domain boundary.
 *
 * Owns, when it is built:
 *   - WhatsApp, SMS and push delivery behind the `NotificationChannel` seam
 *   - message templating and delivery state
 *
 * Provider-free: no
 * `NOTIFICATION_CHANNELS` implementation is registered, so nothing can send
 * anything to a real patient by accident. Inbox persistence and its outbox are
 * complete without coupling the domain to a delivery vendor.
 */
@Module({
  imports: [ServerCoreModule],
  controllers: [
    MessagesController,
    ParentMessagesController,
    ParentNotificationsController,
  ],
  providers: [MessagesService, ParentNotificationsService],
  exports: [MessagesService, ParentNotificationsService],
})
export class NotificationsModule {}

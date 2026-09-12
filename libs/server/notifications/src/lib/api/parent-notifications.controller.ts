import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  UserRole,
  type ParentNotification,
  type ParentNotificationsView,
} from '@clinic/contracts';
import {
  CurrentGuardian,
  Roles,
  type GuardianContext,
} from '@clinic/server-core';
import { ParentNotificationsService } from '../parent-notifications.service';
import { NotificationsExceptionFilter } from './notifications-exception.filter';

@Controller({ path: 'me/notifications', version: '1' })
@Roles(UserRole.Guardian)
@UseFilters(NotificationsExceptionFilter)
export class ParentNotificationsController {
  constructor(private readonly notifications: ParentNotificationsService) {}

  @Get()
  list(
    @CurrentGuardian() guardian: GuardianContext,
  ): Promise<ParentNotificationsView> {
    return this.notifications.list(guardian.clinicId, guardian.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  markAllRead(@CurrentGuardian() guardian: GuardianContext): Promise<void> {
    return this.notifications.markAllRead(guardian.clinicId, guardian.id);
  }

  @Post(':notificationId/read')
  markRead(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
  ): Promise<ParentNotification> {
    return this.notifications.markRead(
      guardian.clinicId,
      guardian.id,
      notificationId,
    );
  }
}

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  CurrentMember,
  Public,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import {
  UserRole,
  type GuestQueueView,
  type QueueGuestLink,
} from '@clinic/contracts';
import { QueueGuestLinkService } from '../queue-guest-link.service';
import { QueueExceptionFilter } from './queue-exception.filter';

@Controller({ version: '1' })
@UseFilters(QueueExceptionFilter)
export class QueueGuestController {
  constructor(private readonly links: QueueGuestLinkService) {}

  @Roles(UserRole.Reception, UserRole.Admin)
  @Post('clinic/queue/:entryId/guest-link')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<QueueGuestLink> {
    return this.links.create(member.clinicId, entryId, member.id);
  }

  @Roles(UserRole.Reception, UserRole.Admin)
  @Delete('clinic/queue/:entryId/guest-link')
  revoke(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<{ revoked: true }> {
    return this.links.revoke(member.clinicId, entryId);
  }

  @Public()
  @Get('queue/guest/:token')
  read(@Param('token') token: string): Promise<GuestQueueView> {
    return this.links.read(token);
  }
}

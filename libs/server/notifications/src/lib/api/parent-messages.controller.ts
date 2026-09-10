import {
  Body,
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
  type MessageThreadDetail,
  type ParentMessageInbox,
  type ThreadMessage,
  type UrgentCaseSummary,
} from '@clinic/contracts';
import {
  CurrentGuardian,
  Roles,
  type GuardianContext,
} from '@clinic/server-core';
import { MessagesService } from '../messages.service';
import {
  CreateParentMessageThreadDto,
  RaiseUrgentCaseDto,
  ReplyToThreadDto,
} from './messages.dto';
import { MessagesExceptionFilter } from './messages-exception.filter';

/**
 * The guardian's own conversations.
 *
 * No clinic or guardian identifier is accepted from the browser. Every query
 * includes both values resolved from the authenticated request, so a guessed
 * thread UUID is indistinguishable from a missing one.
 */
@Controller({ path: 'messages', version: '1' })
@UseFilters(MessagesExceptionFilter)
@Roles(UserRole.Guardian)
export class ParentMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  inbox(@CurrentGuardian() guardian: GuardianContext): Promise<ParentMessageInbox> {
    return this.messages.parentInbox(guardian.clinicId, guardian.id);
  }

  @Post()
  create(
    @CurrentGuardian() guardian: GuardianContext,
    @Body() body: CreateParentMessageThreadDto,
  ): Promise<MessageThreadDetail> {
    return this.messages.createParentThread(
      guardian.clinicId,
      guardian.id,
      body,
    );
  }

  @Get(':threadId')
  detail(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('threadId', new ParseUUIDPipe()) threadId: string,
  ): Promise<MessageThreadDetail> {
    return this.messages.parentDetail(
      guardian.clinicId,
      guardian.id,
      threadId,
    );
  }

  @Post(':threadId/replies')
  reply(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('threadId', new ParseUUIDPipe()) threadId: string,
    @Body() body: ReplyToThreadDto,
  ): Promise<ThreadMessage> {
    return this.messages.parentReply(
      guardian.clinicId,
      guardian.id,
      threadId,
      body.body,
      body.clientRequestId,
    );
  }

  @Post(':threadId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('threadId', new ParseUUIDPipe()) threadId: string,
  ): Promise<void> {
    return this.messages.parentMarkRead(
      guardian.clinicId,
      guardian.id,
      threadId,
    );
  }

  @Post(':threadId/urgent')
  urgent(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('threadId', new ParseUUIDPipe()) threadId: string,
    @Body() body: RaiseUrgentCaseDto,
  ): Promise<UrgentCaseSummary> {
    return this.messages.parentRaiseUrgent(
      guardian.clinicId,
      guardian.id,
      threadId,
      body.triageNote,
    );
  }
}

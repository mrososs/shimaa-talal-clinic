import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { UserRole, type MessageInbox, type MessageThreadDetail, type MessageThreadSummary, type ThreadMessage, type UrgentCaseSummary } from '@clinic/contracts';
import { CurrentMember, Roles, type ClinicMemberContext } from '@clinic/server-core';
import { MessagesService } from '../messages.service';
import { CreateMessageThreadDto, DecideUrgentCaseDto, MessageInboxQueryDto, RaiseUrgentCaseDto, ReplyToThreadDto } from './messages.dto';
import { MessagesExceptionFilter } from './messages-exception.filter';

@Controller({ path: 'clinic/messages', version: '1' })
@UseFilters(MessagesExceptionFilter)
@Roles(UserRole.Doctor, UserRole.Reception, UserRole.Admin)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  inbox(@CurrentMember() member: ClinicMemberContext, @Query() query: MessageInboxQueryDto): Promise<MessageInbox> {
    return this.messages.inbox(member.clinicId, member.id, query.filter ?? 'all');
  }

  @Post('threads')
  create(@CurrentMember() member: ClinicMemberContext, @Body() body: CreateMessageThreadDto): Promise<MessageThreadDetail> {
    return this.messages.createThread(member.clinicId, member.id, body);
  }

  @Get(':threadId')
  detail(@CurrentMember() member: ClinicMemberContext, @Param('threadId', new ParseUUIDPipe()) threadId: string): Promise<MessageThreadDetail> {
    return this.messages.detail(member.clinicId, member.id, threadId);
  }

  @Post(':threadId/replies')
  reply(@CurrentMember() member: ClinicMemberContext, @Param('threadId', new ParseUUIDPipe()) threadId: string, @Body() body: ReplyToThreadDto): Promise<ThreadMessage> {
    return this.messages.reply(member.clinicId, member.id, threadId, body.body, body.clientRequestId);
  }

  @Post(':threadId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentMember() member: ClinicMemberContext, @Param('threadId', new ParseUUIDPipe()) threadId: string): Promise<void> {
    return this.messages.markRead(member.clinicId, member.id, threadId);
  }

  @Post(':threadId/assign-to-doctor')
  @Roles(UserRole.Reception, UserRole.Admin)
  assignDoctor(@CurrentMember() member: ClinicMemberContext, @Param('threadId', new ParseUUIDPipe()) threadId: string): Promise<MessageThreadSummary> {
    return this.messages.assignToDoctor(member.clinicId, member.id, threadId);
  }

  @Post(':threadId/close')
  close(@CurrentMember() member: ClinicMemberContext, @Param('threadId', new ParseUUIDPipe()) threadId: string): Promise<MessageThreadSummary> {
    return this.messages.setClosed(member.clinicId, member.id, threadId, true);
  }

  @Post(':threadId/reopen')
  reopen(@CurrentMember() member: ClinicMemberContext, @Param('threadId', new ParseUUIDPipe()) threadId: string): Promise<MessageThreadSummary> {
    return this.messages.setClosed(member.clinicId, member.id, threadId, false);
  }

  @Post(':threadId/urgent')
  @Roles(UserRole.Reception, UserRole.Admin)
  urgent(@CurrentMember() member: ClinicMemberContext, @Param('threadId', new ParseUUIDPipe()) threadId: string, @Body() body: RaiseUrgentCaseDto): Promise<UrgentCaseSummary> {
    return this.messages.raiseUrgent(member.clinicId, member.id, threadId, body.triageNote);
  }

  @Post('urgent-cases/:caseId/reject')
  @Roles(UserRole.Doctor, UserRole.Admin)
  reject(@CurrentMember() member: ClinicMemberContext, @Param('caseId', new ParseUUIDPipe()) caseId: string, @Body() body: DecideUrgentCaseDto): Promise<UrgentCaseSummary> {
    return this.messages.rejectUrgent(member.clinicId, member.id, caseId, body.decisionNote ?? null);
  }
}

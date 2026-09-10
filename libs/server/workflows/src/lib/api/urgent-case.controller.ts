import { Body, Controller, Param, ParseUUIDPipe, Post, UseFilters } from '@nestjs/common';
import { UserRole, type AcceptUrgentCaseResult } from '@clinic/contracts';
import { CurrentMember, Roles, type ClinicMemberContext } from '@clinic/server-core';
import { AcceptUrgentCaseWorkflow } from '../urgent-case.workflow';
import { AcceptUrgentCaseDto } from './urgent-case.dto';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

@Controller({ path: 'clinic/messages/urgent-cases', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class UrgentCaseController {
  constructor(private readonly workflow: AcceptUrgentCaseWorkflow) {}

  @Post(':caseId/accept')
  @Roles(UserRole.Doctor, UserRole.Admin)
  accept(
    @CurrentMember() member: ClinicMemberContext,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() body: AcceptUrgentCaseDto,
  ): Promise<AcceptUrgentCaseResult> {
    return this.workflow.execute({
      clinicId: member.clinicId,
      caseId,
      sessionId: body.sessionId,
      memberId: member.id,
      decisionNote: body.decisionNote ?? null,
    });
  }
}

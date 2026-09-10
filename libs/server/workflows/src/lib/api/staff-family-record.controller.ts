import { Controller, Get, Param, ParseUUIDPipe, UseFilters } from '@nestjs/common';
import { CurrentMember, Roles, type ClinicMemberContext } from '@clinic/server-core';
import { UserRole, type StaffFamilyRecord } from '@clinic/contracts';
import { StaffFamilyRecordWorkflow } from '../staff-family-record.workflow';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

@Controller({ path: 'clinic/guardians', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class StaffFamilyRecordController {
  constructor(private readonly records: StaffFamilyRecordWorkflow) {}

  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get(':guardianId/record')
  record(
    @CurrentMember() member: ClinicMemberContext,
    @Param('guardianId', new ParseUUIDPipe()) guardianId: string,
  ): Promise<StaffFamilyRecord> {
    return this.records.execute({ clinicId: member.clinicId, guardianId });
  }
}

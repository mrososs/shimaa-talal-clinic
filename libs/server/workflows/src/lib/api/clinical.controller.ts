import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseFilters,
} from '@nestjs/common';
import {
  UserRole,
  type ClinicalEncounter,
  type ClinicalMeasurement,
  type ClinicalRecord,
} from '@clinic/contracts';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { ClinicalWorkflow } from '../clinical.workflow';
import {
  CreateClinicalMeasurementDto,
  SaveClinicalEncounterDto,
} from './clinical.dto';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

@Controller({ path: 'clinic', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class ClinicalController {
  constructor(private readonly clinical: ClinicalWorkflow) {}

  @Get('appointments/:appointmentId/clinical-record')
  @Roles(UserRole.Doctor, UserRole.Admin)
  record(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<ClinicalRecord> {
    return this.clinical.record(member.clinicId, appointmentId);
  }

  @Put('appointments/:appointmentId/clinical-record/draft')
  @Roles(UserRole.Doctor, UserRole.Admin)
  saveDraft(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() data: SaveClinicalEncounterDto,
  ): Promise<ClinicalEncounter> {
    return this.clinical.saveDraft({
      clinicId: member.clinicId,
      appointmentId,
      memberId: member.id,
      data,
    });
  }

  @Post('appointments/:appointmentId/clinical-record/finalize')
  @Roles(UserRole.Doctor, UserRole.Admin)
  finalize(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() data: SaveClinicalEncounterDto,
  ): Promise<ClinicalEncounter> {
    return this.clinical.finalize({
      clinicId: member.clinicId,
      appointmentId,
      memberId: member.id,
      data,
    });
  }

  @Get('children/:childId/measurements')
  @Roles(UserRole.Doctor, UserRole.Admin)
  measurements(
    @CurrentMember() member: ClinicMemberContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<ClinicalMeasurement[]> {
    return this.clinical.measurements(member.clinicId, childId);
  }

  @Post('children/:childId/measurements')
  @Roles(UserRole.Doctor, UserRole.Reception, UserRole.Admin)
  addMeasurement(
    @CurrentMember() member: ClinicMemberContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @Body() data: CreateClinicalMeasurementDto,
  ): Promise<ClinicalMeasurement> {
    return this.clinical.addMeasurement({
      clinicId: member.clinicId,
      childId,
      memberId: member.id,
      data,
    });
  }
}

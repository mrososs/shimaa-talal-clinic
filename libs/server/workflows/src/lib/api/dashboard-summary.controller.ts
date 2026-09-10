import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import { UserRole, type DashboardSummary } from '@clinic/contracts';
import { DashboardSummaryWorkflow } from '../dashboard-summary.workflow';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DashboardSummaryQueryDto {
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

@Controller({ path: 'clinic/dashboard', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class DashboardSummaryController {
  constructor(
    private readonly clinics: ClinicService,
    private readonly summary: DashboardSummaryWorkflow,
  ) {}

  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get('summary')
  async read(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: DashboardSummaryQueryDto,
  ): Promise<DashboardSummary> {
    const clinic = await this.clinics.findById(member.clinicId);
    if (clinic === null) {
      throw new Error(`Clinic ${member.clinicId} is missing or inactive.`);
    }

    return this.summary.execute({
      clinicId: clinic.id,
      date: query.date ?? clinic.today,
    });
  }
}

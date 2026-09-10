import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseFilters,
} from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import {
  UserRole,
  type ClinicReport,
  type PaymentsDashboard,
  type ReportExport,
} from '@clinic/contracts';
import { PaymentsReportWorkflow } from '../payments-report.workflow';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
class ReportQueryDto {
  @IsOptional() @IsString() @Matches(ISO_DATE) from?: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) to?: string;
}

@Controller({ path: 'clinic', version: '1' })
@Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
@UseFilters(WorkflowsExceptionFilter)
export class PaymentsReportController {
  constructor(
    private readonly clinics: ClinicService,
    private readonly workflow: PaymentsReportWorkflow,
  ) {}

  @Get('payments')
  payments(
    @CurrentMember() member: ClinicMemberContext,
  ): Promise<PaymentsDashboard> {
    return this.workflow.paymentsDashboard(member.clinicId);
  }

  @Get('reports')
  async report(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: ReportQueryDto,
  ): Promise<ClinicReport> {
    const clinic = await this.clinics.findById(member.clinicId);
    if (!clinic) throw new BadRequestException('Clinic is unavailable.');
    const to = query.to ?? clinic.today;
    const from = query.from ?? addDays(to, -6);
    validateRange(from, to);
    return this.workflow.report({
      clinicId: member.clinicId,
      role: member.role,
      timezone: clinic.timezone,
      from,
      to,
    });
  }

  @Get('reports/export')
  async export(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: ReportQueryDto,
  ): Promise<ReportExport> {
    const report = await this.report(member, query);
    const rows = [
      ['metric', 'value'],
      ['appointments', String(report.appointments.total)],
      ['completed', String(report.appointments.completed)],
      ['no_show', String(report.appointments.noShow)],
      ['average_wait_minutes', String(report.queue.averageWaitMinutes ?? '')],
      [
        'average_service_minutes',
        String(report.queue.averageServiceMinutes ?? ''),
      ],
    ];
    if (report.financial) {
      rows.push(
        ['collected_minor', String(report.financial.collectedMinor)],
        ['pending_minor', String(report.financial.pendingMinor)],
        ['refunded_minor', String(report.financial.refundedMinor)],
      );
    }
    return {
      fileName: `clinic-report-${report.from}-${report.to}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: '\uFEFF' + rows.map((r) => r.map(csv).join(',')).join('\r\n'),
    };
  }
}
function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function validateRange(from: string, to: string) {
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (days < 0 || days > 366)
    throw new BadRequestException(
      'Report range must be ordered and no longer than 367 days.',
    );
}
function csv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

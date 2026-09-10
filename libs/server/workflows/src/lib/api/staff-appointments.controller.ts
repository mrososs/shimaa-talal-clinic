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
import { UserRole, type AppointmentListItem } from '@clinic/contracts';
import { StaffAppointmentsWorkflow } from '../staff-appointments.workflow';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class StaffAppointmentsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/**
 * The staff day list keeps its public Booking URL while its read model is
 * assembled here from Booking and Patients.
 */
@Controller({ path: 'clinic', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class StaffAppointmentsController {
  constructor(
    private readonly clinics: ClinicService,
    private readonly appointments: StaffAppointmentsWorkflow,
  ) {}

  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get('appointments')
  async listDay(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: StaffAppointmentsQueryDto,
  ): Promise<AppointmentListItem[]> {
    const clinic = await this.clinics.findById(member.clinicId);
    if (clinic === null) {
      throw new Error(`Clinic ${member.clinicId} is missing or inactive.`);
    }

    const date = query.date ?? clinic.today;
    if (query.to !== undefined) validateRange(date, query.to);

    return this.appointments.execute({
      clinicId: clinic.id,
      date,
      to: query.to,
    });
  }
}

function validateRange(from: string, to: string): void {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  const days = Math.floor((toMs - fromMs) / 86_400_000) + 1;
  if (days < 1 || days > 31) {
    throw new BadRequestException('Appointment range must be 1 to 31 days.');
  }
}

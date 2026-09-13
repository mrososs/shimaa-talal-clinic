import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import { IsIn } from 'class-validator';
import {
  CurrentGuardian,
  CurrentMember,
  CurrentUser,
  Public,
  Roles,
  type AuthenticatedUser,
  type ClinicMemberContext,
  type GuardianContext,
} from '@clinic/server-core';
import {
  AttendanceIntent,
  UserRole,
  type AppointmentTrackingCapability,
  type AppointmentTrackingView,
  type StaffEstimateDiagnostic,
} from '@clinic/contracts';
import { AppointmentTrackingWorkflow } from '../appointment-tracking.workflow';
import { AppointmentTrackingCapabilityService } from '../appointment-tracking-capability.service';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

class AttendanceIntentDto {
  @IsIn([AttendanceIntent.Coming, AttendanceIntent.NotComing])
  intent!: typeof AttendanceIntent.Coming | typeof AttendanceIntent.NotComing;
}

@Controller({ version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class AppointmentTrackingController {
  constructor(
    private readonly tracking: AppointmentTrackingWorkflow,
    private readonly capabilities: AppointmentTrackingCapabilityService,
  ) {}

  @Roles(UserRole.Guardian)
  @Get('appointments/:appointmentId/tracking')
  parent(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<AppointmentTrackingView> {
    return this.tracking.parentView(
      guardian.clinicId,
      guardian.id,
      appointmentId,
    );
  }

  @Roles(UserRole.Guardian)
  @Post('appointments/:appointmentId/attendance')
  attendance(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentGuardian() guardian: GuardianContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: AttendanceIntentDto,
  ): Promise<AppointmentTrackingView> {
    return this.tracking.setAttendance(
      guardian.clinicId,
      guardian.id,
      user.id,
      appointmentId,
      body.intent,
    );
  }

  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get('clinic/appointments/:appointmentId/tracking')
  staff(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<StaffEstimateDiagnostic> {
    return this.tracking.staffDiagnostic(member.clinicId, appointmentId);
  }

  @Roles(UserRole.Reception, UserRole.Admin)
  @Post('clinic/appointments/:appointmentId/guest-link')
  createLink(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<AppointmentTrackingCapability> {
    return this.capabilities.create(member.clinicId, appointmentId, member.id);
  }

  @Roles(UserRole.Reception, UserRole.Admin)
  @Delete('clinic/appointments/:appointmentId/guest-link')
  revokeLink(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<{ revoked: true }> {
    return this.capabilities.revoke(member.clinicId, appointmentId);
  }

  /** The raw capability is sent in a header; it never appears in URL logs. */
  @Public()
  @Get('tracking/guest')
  async guest(
    @Headers('x-tracking-token') token = '',
  ): Promise<AppointmentTrackingView> {
    const resolved = await this.capabilities.resolve(token);
    return this.tracking.guestView(resolved.clinicId, resolved.appointmentId);
  }

  @Public()
  @Post('tracking/guest/attendance')
  async guestAttendance(
    @Headers('x-tracking-token') token = '',
    @Body() body: AttendanceIntentDto,
  ): Promise<AppointmentTrackingView> {
    const resolved = await this.capabilities.resolve(token);
    return this.tracking.setGuestAttendance(
      resolved.clinicId,
      resolved.appointmentId,
      body.intent,
    );
  }
}

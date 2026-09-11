import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import {
  CHILD_ACCESS_CHECKER,
  CurrentMember,
  Roles,
  type ChildAccessChecker,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import {
  AppointmentStatus,
  UserRole,
  type Appointment,
  type AvailabilityDay,
  type Clinic,
} from '@clinic/contracts';
import { AppointmentService } from '../appointment.service';
import { AvailabilityService } from '../availability.service';
import { BookingError, BookingErrorCode } from '../booking.errors';
import {
  CancelAppointmentDto,
  CreateClinicAppointmentDto,
  StaffAvailabilityQueryDto,
} from './booking.dto';
import { BookingExceptionFilter } from './booking-exception.filter';
import { range } from './appointments.controller';

/**
 * Reception and the doctor, working the day.
 *
 * The clinic comes from `@CurrentMember()` — never from a body, a query or a
 * path — which is what makes one clinic unable to touch another's appointments.
 *
 * Every role here may run every command. That is deliberate and it is what the
 * plan's matrix says: approving, cancelling and rescheduling are all things the
 * doctor legitimately does when reception is with a patient. The split that
 * matters is identity management, which stays reception's, and check-in, which
 * belongs to the queue.
 */
@Controller({ path: 'clinic', version: '1' })
@UseFilters(BookingExceptionFilter)
export class ClinicAppointmentsController {
  constructor(
    private readonly appointments: AppointmentService,
    private readonly availability: AvailabilityService,
    private readonly clinics: ClinicService,
    @Inject(CHILD_ACCESS_CHECKER)
    private readonly childAccess: ChildAccessChecker,
  ) {}

  /**
   * Availability, including full windows when asked.
   *
   * Staff need to see a full window rather than a gap: "why is there nothing at
   * eleven" has two different answers, and only one of them is a closure.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get('availability')
  async availability_(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: StaffAvailabilityQueryDto,
  ): Promise<AvailabilityDay[]> {
    const clinic = await this.requireClinic(member.clinicId);
    return this.availability.forRange(clinic.id, {
      ...range(clinic, query),
      includeFull: query.includeFull !== 'false',
    });
  }

  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get('appointments/:appointmentId')
  async detail(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<Appointment> {
    return this.requireAppointment(member.clinicId, appointmentId);
  }

  /**
   * Book on a family's behalf.
   *
   * Confirmed immediately, because the person who would approve it is the
   * person booking it. The whole point of this endpoint is that it works for a
   * family with no app and no account.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('appointments')
  async create(
    @CurrentMember() member: ClinicMemberContext,
    @Body() body: CreateClinicAppointmentDto,
  ): Promise<Appointment> {
    const accessible = await this.childAccess.canGuardianAccessChild(
      member.clinicId,
      body.guardianId,
      body.childId,
    );
    if (!accessible) {
      throw new BookingError(
        BookingErrorCode.ChildNotAccessible,
        'That guardian cannot book for this child at this clinic.',
      );
    }
    return this.appointments.create({
      clinicId: member.clinicId,
      sessionId: body.sessionId,
      windowStart: body.windowStart,
      childId: body.childId,
      guardianId: body.guardianId,
      visitType: body.visitType,
      notes: body.notes ?? null,
      createdByMemberId: member.id,
    });
  }

  /** Accept a parent's request. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('appointments/:appointmentId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<Appointment> {
    return this.appointments.transition(
      member.clinicId,
      appointmentId,
      AppointmentStatus.Confirmed,
      { memberId: member.id },
    );
  }

  /**
   * Turn a request down.
   *
   * A cancellation with a clinic author and a reason, not a status of its own:
   * reporting can tell a rejection from a parent's cancellation by who did it,
   * and the state machine does not need a sixth terminal state to do the same
   * job.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('appointments/:appointmentId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: CancelAppointmentDto,
  ): Promise<Appointment> {
    return this.appointments.transition(
      member.clinicId,
      appointmentId,
      AppointmentStatus.Cancelled,
      { memberId: member.id, reason: body.reason ?? null },
    );
  }

  // Cancelling lives in @clinic/server-workflows: a checked-in family has a
  // queue entry that must be cancelled in the same commit, and Booking may not
  // depend on Queue.

  private async requireAppointment(
    clinicId: string,
    appointmentId: string,
  ): Promise<Appointment> {
    const appointment = await this.appointments.findById(
      clinicId,
      appointmentId,
    );
    if (appointment === null) {
      // An appointment at another clinic reads as "no such appointment".
      throw new BookingError(
        BookingErrorCode.AppointmentNotFound,
        'No such appointment at this clinic.',
      );
    }
    return appointment;
  }

  private async requireClinic(clinicId: string): Promise<Clinic> {
    const clinic = await this.clinics.findById(clinicId);
    if (clinic === null) {
      throw new Error(`Clinic ${clinicId} is missing or inactive.`);
    }
    return clinic;
  }
}

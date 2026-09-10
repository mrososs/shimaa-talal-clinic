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
  CurrentGuardian,
  CurrentUser,
  Roles,
  type AuthenticatedUser,
  type ChildAccessChecker,
  type GuardianContext,
} from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import {
  UserRole,
  type Appointment,
  type AvailabilityDay,
  type Clinic,
} from '@clinic/contracts';
import { AppointmentService } from '../appointment.service';
import { AvailabilityService } from '../availability.service';
import { BookingError, BookingErrorCode } from '../booking.errors';
import {
  AppointmentScopeQueryDto,
  AvailabilityQueryDto,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from './booking.dto';
import { BookingExceptionFilter } from './booking-exception.filter';

/** How far ahead a parent may look when they do not say. */
const DEFAULT_RANGE_DAYS = 6;

/**
 * A parent, booking for their own children.
 *
 * Every route here is scoped by the guardian on the token. No route takes a
 * `guardianId` or a `clinicId`, because a parameter a client can set is a
 * parameter a client can change — and another family's appointment answers 404,
 * never 403, so the API does not confirm it exists.
 *
 * Writes that move the state machine are named commands rather than a
 * `PATCH {status}`: each has different preconditions, different authorisation
 * and different side effects, and a generic patch would either let a client
 * name an illegal target state or push a `switch` into this file.
 */
@Controller({ version: '1' })
@UseFilters(BookingExceptionFilter)
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentService,
    private readonly availability: AvailabilityService,
    private readonly clinics: ClinicService,
    @Inject(CHILD_ACCESS_CHECKER)
    private readonly childAccess: ChildAccessChecker,
  ) {}

  /**
   * The windows this family can book.
   *
   * Advisory, and the contract says so: the count is true when computed and a
   * booking can still lose the race for the last seat.
   */
  @Roles(UserRole.Guardian)
  @Get('booking/availability')
  async availabilityForParent(
    @CurrentGuardian() guardian: GuardianContext,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityDay[]> {
    const clinic = await this.requireClinic(guardian.clinicId);
    return this.availability.forRange(clinic.id, range(clinic, query));
  }

  @Roles(UserRole.Guardian)
  @Get('appointments')
  listMine(
    @CurrentGuardian() guardian: GuardianContext,
    @Query() query: AppointmentScopeQueryDto,
  ): Promise<Appointment[]> {
    return this.appointments.listForGuardian(
      guardian.clinicId,
      guardian.id,
      query.scope ?? 'upcoming',
    );
  }

  @Roles(UserRole.Guardian)
  @Get('appointments/:appointmentId')
  async detail(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<Appointment> {
    return this.requireOwn(guardian, appointmentId);
  }

  /**
   * Book a window.
   *
   * The child is checked against this guardian before anything is held. That
   * fact belongs to Patients, so it arrives through a port rather than an
   * import — Booking may not depend on another domain, and duplicating the
   * "owns" query is how two versions of it end up disagreeing.
   */
  @Roles(UserRole.Guardian)
  @Post('appointments')
  async book(
    @CurrentGuardian() guardian: GuardianContext,
    @Body() body: CreateAppointmentDto,
  ): Promise<Appointment> {
    await this.requireChild(guardian, body.childId);

    return this.appointments.create({
      clinicId: guardian.clinicId,
      sessionId: body.sessionId,
      windowStart: body.windowStart,
      childId: body.childId,
      guardianId: guardian.id,
      visitType: body.visitType,
      notes: body.notes ?? null,
      // Null: the parent booked it themselves, which is also what decides
      // whether it lands as a request or a confirmed booking.
      createdByMemberId: null,
    });
  }

  // Cancelling lives in @clinic/server-workflows: if the family has already
  // checked in, their queue entry must go with the appointment, and Booking
  // may not depend on Queue.

  @Roles(UserRole.Guardian)
  @Post('appointments/:appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  async reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentGuardian() guardian: GuardianContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: RescheduleAppointmentDto,
  ): Promise<Appointment> {
    await this.requireOwn(guardian, appointmentId);

    return this.appointments.reschedule(
      guardian.clinicId,
      appointmentId,
      { sessionId: body.sessionId, windowStart: body.windowStart },
      { authUserId: user.id },
    );
  }

  /**
   * The appointment, if it is this guardian's.
   *
   * Reports "not found" for somebody else's, which is the same answer an
   * invented id gets. The difference between those two answers is itself
   * information about another family.
   */
  private async requireOwn(
    guardian: GuardianContext,
    appointmentId: string,
  ): Promise<Appointment> {
    const appointment = await this.appointments.findById(
      guardian.clinicId,
      appointmentId,
    );
    if (appointment === null || appointment.guardianId !== guardian.id) {
      throw new BookingError(
        BookingErrorCode.AppointmentNotFound,
        'No such appointment.',
      );
    }
    return appointment;
  }

  private async requireChild(
    guardian: GuardianContext,
    childId: string,
  ): Promise<void> {
    const allowed = await this.childAccess.canGuardianAccessChild(
      guardian.clinicId,
      guardian.id,
      childId,
    );
    if (!allowed) {
      throw new BookingError(
        BookingErrorCode.ChildNotAccessible,
        'No such child.',
      );
    }
  }

  private async requireClinic(clinicId: string): Promise<Clinic> {
    const clinic = await this.clinics.findById(clinicId);
    if (clinic === null) {
      throw new Error(`Clinic ${clinicId} is missing or inactive.`);
    }
    return clinic;
  }
}

/**
 * The days to look at, defaulting to the clinic's own week.
 *
 * "Today" comes from the clinic, not the caller: at 22:30 UTC it is already
 * tomorrow in Cairo, and a client deriving it from its own clock would ask for
 * the wrong day for three hours every night.
 */
export function range(
  clinic: Clinic,
  query: { date?: string; to?: string },
): { from: string; to: string } {
  const from = query.date ?? clinic.today;
  return { from, to: query.to ?? addDays(from, DEFAULT_RANGE_DAYS) };
}

function addDays(date: string, days: number): string {
  // Parsed as UTC and only ever used as a calendar date, so no zone applies.
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

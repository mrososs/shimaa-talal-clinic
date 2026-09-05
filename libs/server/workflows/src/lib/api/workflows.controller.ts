import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  CurrentGuardian,
  CurrentMember,
  CurrentUser,
  Roles,
  type AuthenticatedUser,
  type ClinicMemberContext,
  type GuardianContext,
} from '@clinic/server-core';
import {
  AppointmentService,
  BookingError,
  BookingErrorCode,
} from '@clinic/server-booking';
import { UserRole, type Appointment, type QueueEntry } from '@clinic/contracts';
import { CancelAppointmentWorkflow } from '../cancel-appointment.workflow';
import { CheckInAppointmentWorkflow } from '../check-in-appointment.workflow';
import { CompleteQueueEntryWorkflow } from '../complete-queue-entry.workflow';
import { CancelReasonDto } from './workflows.dto';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

/**
 * The four routes whose work spans two domains.
 *
 * They live here rather than in Booking or Queue for the reason those two
 * libraries exist separately at all: neither may depend on the other, so
 * neither can own a request that has to change both. A controller in Booking
 * calling into Queue would be the coupling the boundaries prevent, dressed up
 * as an HTTP handler.
 *
 * Cancelling is here for a concrete reason, not a theoretical one. A family
 * that has already checked in has a queue entry, and cancelling the appointment
 * without it leaves a patient on the board nobody is expecting — one that "call
 * next" will happily announce.
 */
@Controller({ version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class WorkflowsController {
  constructor(
    private readonly checkIn: CheckInAppointmentWorkflow,
    private readonly completion: CompleteQueueEntryWorkflow,
    private readonly cancellation: CancelAppointmentWorkflow,
    private readonly appointments: AppointmentService,
  ) {}

  /**
   * The patient has arrived.
   *
   * Creates the queue entry and moves the appointment in one commit. Doing it
   * twice returns the same entry — a double-click at a busy desk is not an
   * error.
   */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post('clinic/appointments/:appointmentId/check-in')
  @HttpCode(HttpStatus.CREATED)
  checkInAppointment(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<QueueEntry> {
    return this.checkIn.execute({
      clinicId: member.clinicId,
      appointmentId,
      memberId: member.id,
    });
  }

  /**
   * The consultation is over.
   *
   * Any active member may complete: the doctor finishing in the room is the
   * commonest caller, and reception closing out a visit is ordinary too.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('clinic/queue/:entryId/complete')
  @HttpCode(HttpStatus.OK)
  completeEntry(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<QueueEntry> {
    return this.completion.execute({
      clinicId: member.clinicId,
      entryId,
      memberId: member.id,
    });
  }

  /** Staff calling a visit off. No cutoff — somebody has to be able to. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('clinic/appointments/:appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelAsStaff(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: CancelReasonDto,
  ): Promise<Appointment> {
    return this.cancellation.execute({
      clinicId: member.clinicId,
      appointmentId,
      memberId: member.id,
      reason: body.reason ?? null,
    });
  }

  /**
   * A parent calling their own visit off.
   *
   * Ownership is checked here, and the clinic's cutoff is applied by Booking.
   * Another family's appointment answers "not found" — the same answer an
   * invented id gets, because the difference between those two is information
   * about somebody else.
   */
  @Roles(UserRole.Guardian)
  @Post('appointments/:appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelAsParent(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentGuardian() guardian: GuardianContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: CancelReasonDto,
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

    return this.cancellation.execute({
      clinicId: guardian.clinicId,
      appointmentId,
      authUserId: user.id,
      reason: body.reason ?? null,
      enforceCutoff: true,
    });
  }
}

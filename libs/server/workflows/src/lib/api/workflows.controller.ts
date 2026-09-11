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
import { CallNextWorkflow } from '../call-next.workflow';
import { CompleteAndCallNextWorkflow } from '../complete-and-call-next.workflow';
import { NoShowAppointmentWorkflow } from '../no-show-appointment.workflow';
import { RescheduleAppointmentWorkflow } from '../reschedule-appointment.workflow';
import { MissQueueEntryWorkflow } from '../miss-queue-entry.workflow';
import { RequeueEntryWorkflow } from '../requeue-entry.workflow';
import {
  CancelReasonDto,
  MissQueueEntryDto,
  RescheduleAppointmentDto,
  SessionQueueCommandDto,
} from './workflows.dto';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

/**
 * The routes whose work spans two domains.
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
    private readonly callNextWorkflow: CallNextWorkflow,
    private readonly completeAndCallNextWorkflow: CompleteAndCallNextWorkflow,
    private readonly cancellation: CancelAppointmentWorkflow,
    private readonly rescheduling: RescheduleAppointmentWorkflow,
    private readonly noShow: NoShowAppointmentWorkflow,
    private readonly missEntry: MissQueueEntryWorkflow,
    private readonly requeueEntry: RequeueEntryWorkflow,
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

  /** Call the next patient; an active consultation must be ended explicitly. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('clinic/queue/call-next')
  @HttpCode(HttpStatus.OK)
  callNext(
    @CurrentMember() member: ClinicMemberContext,
    @Body() body: SessionQueueCommandDto,
  ): Promise<QueueEntry | null> {
    return this.callNextWorkflow.execute({
      clinicId: member.clinicId,
      sessionId: body.sessionId,
      memberId: member.id,
    });
  }

  /** End the active consultation and call the next patient atomically. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('clinic/queue/complete-and-call-next')
  @HttpCode(HttpStatus.OK)
  completeAndCallNext(
    @CurrentMember() member: ClinicMemberContext,
    @Body() body: SessionQueueCommandDto,
  ): Promise<QueueEntry | null> {
    return this.completeAndCallNextWorkflow.execute({
      clinicId: member.clinicId,
      sessionId: body.sessionId,
      memberId: member.id,
    });
  }

  /** Mark a called patient missed and synchronize Booking/Payments. */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post('clinic/queue/:entryId/miss')
  @HttpCode(HttpStatus.OK)
  miss(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() body: MissQueueEntryDto,
  ): Promise<QueueEntry> {
    return this.missEntry.execute({
      clinicId: member.clinicId,
      entryId,
      memberId: member.id,
      force: body.force ?? false,
      reason: body.reason ?? null,
    });
  }

  /** Return a missed patient and their appointment/payment state together. */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post('clinic/queue/:entryId/requeue')
  @HttpCode(HttpStatus.OK)
  requeue(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<QueueEntry> {
    return this.requeueEntry.execute({
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

  /** Move a staff-managed visit and carry any live payment allocation. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('clinic/appointments/:appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  rescheduleAsStaff(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: RescheduleAppointmentDto,
  ): Promise<Appointment> {
    return this.rescheduling.execute({
      clinicId: member.clinicId,
      appointmentId,
      target: { sessionId: body.sessionId, windowStart: body.windowStart },
      actor: { memberId: member.id },
    });
  }

  /** Mark an absent booked patient and void uncollected cash, not a refund. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('clinic/appointments/:appointmentId/no-show')
  @HttpCode(HttpStatus.OK)
  markNoShow(
    @CurrentMember() member: ClinicMemberContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
  ): Promise<Appointment> {
    return this.noShow.execute({
      clinicId: member.clinicId,
      appointmentId,
      memberId: member.id,
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

  /** Parent move; paid no-shows retain their credit in the same transaction. */
  @Roles(UserRole.Guardian)
  @Post('appointments/:appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  rescheduleAsParent(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentGuardian() guardian: GuardianContext,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() body: RescheduleAppointmentDto,
  ): Promise<Appointment> {
    return this.rescheduling.execute({
      clinicId: guardian.clinicId,
      appointmentId,
      target: { sessionId: body.sessionId, windowStart: body.windowStart },
      actor: { guardianId: guardian.id, authUserId: user.id },
    });
  }
}

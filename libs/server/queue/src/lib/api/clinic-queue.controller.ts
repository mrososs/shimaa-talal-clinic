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
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { UserRole, type QueueEntry } from '@clinic/contracts';
import { QueueCommandService } from '../queue-command.service';
import {
  CallNextDto,
  CancelEntryDto,
  EmergencyDto,
  MissDto,
  MoveEntryDto,
  WalkInDto,
} from './queue.dto';
import { QueueExceptionFilter } from './queue-exception.filter';

/**
 * The board a clinic day is run from.
 *
 * Every command is a named route rather than a `PATCH {status}`. A generic
 * patch would let a client name an illegal target state, and the refusal would
 * arrive with no explanation of which rule it broke — while these routes only
 * exist for moves that are legal, and each says what it refused and why.
 *
 * Two commands are absent and that is deliberate: check-in and complete both
 * change an appointment as well as a queue entry, so they live in
 * `@clinic/server-workflows`. Queue may not depend on Booking.
 *
 * Who may do what follows the plan's matrix. Anyone active can run the queue —
 * the doctor calls the next patient when reception is with a family. Removing
 * somebody, registering a walk-in and reordering stay with reception, because
 * those are desk decisions rather than clinical ones.
 */
@Controller({ path: 'clinic/queue', version: '1' })
@UseFilters(QueueExceptionFilter)
export class ClinicQueueController {
  constructor(private readonly commands: QueueCommandService) {}

  // `GET /clinic/queue` is not here. The board mixes this session's entries
  // with the appointments still expected and the names behind both, which is
  // Booking and Patients as much as Queue — so it is composed in
  // `@clinic/server-workflows` and served on the same path from there.

  /**
   * A patient with no booking.
   *
   * No appointment row is fabricated for them: `appointment_id` stays null and
   * the entry is ordinary in every other way. A walk-in is not a degraded
   * appointment.
   */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post('walk-in')
  walkIn(
    @CurrentMember() member: ClinicMemberContext,
    @Body() body: WalkInDto,
  ): Promise<QueueEntry> {
    return this.commands.admit(
      {
        clinicId: member.clinicId,
        sessionId: body.sessionId,
        childId: body.childId,
        guardianId: body.guardianId ?? null,
        visitReason: body.visitReason ?? null,
      },
      { memberId: member.id },
    );
  }

  /** "Next please." Completes whoever is in the room and calls the next. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post('call-next')
  @HttpCode(HttpStatus.OK)
  callNext(
    @CurrentMember() member: ClinicMemberContext,
    @Body() body: CallNextDto,
  ): Promise<QueueEntry> {
    return this.commands.callNext(member.clinicId, body.sessionId, {
      memberId: member.id,
    });
  }

  /** Call one specific patient, out of turn if staff decide to. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':entryId/call')
  @HttpCode(HttpStatus.OK)
  call(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<QueueEntry> {
    return this.commands.call(member.clinicId, entryId, {
      memberId: member.id,
    });
  }

  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':entryId/start')
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<QueueEntry> {
    return this.commands.start(member.clinicId, entryId, {
      memberId: member.id,
    });
  }

  /**
   * Called, did not come.
   *
   * Refused while the grace period is still running unless `force` is set with
   * a reason. The deadline is the promise the clinic made when it called them.
   */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post(':entryId/miss')
  @HttpCode(HttpStatus.OK)
  miss(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() body: MissDto,
  ): Promise<QueueEntry> {
    return this.commands.miss(member.clinicId, entryId, {
      memberId: member.id,
      force: body.force ?? false,
      reason: body.reason ?? null,
    });
  }

  /** Back in the queue, with a new number, at the end. */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post(':entryId/requeue')
  @HttpCode(HttpStatus.OK)
  requeue(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<QueueEntry> {
    return this.commands.requeue(member.clinicId, entryId, {
      memberId: member.id,
    });
  }

  @Roles(UserRole.Reception, UserRole.Admin)
  @Post(':entryId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() body: CancelEntryDto,
  ): Promise<QueueEntry> {
    return this.commands.cancel(member.clinicId, entryId, {
      memberId: member.id,
      reason: body.reason ?? null,
    });
  }

  /**
   * Mark or clear an emergency.
   *
   * A reason is required to mark one and recorded against the member who did
   * it. Reversible, because staff mis-tap and an emergency that cannot be
   * undone would quietly distort the rest of the day.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':entryId/emergency')
  @HttpCode(HttpStatus.OK)
  emergency(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() body: EmergencyDto,
  ): Promise<QueueEntry> {
    return this.commands.setEmergency(
      member.clinicId,
      entryId,
      body.emergency,
      { memberId: member.id, reason: body.reason ?? null },
    );
  }

  /** Move a patient between two neighbours. One row changes. */
  @Roles(UserRole.Reception, UserRole.Admin)
  @Post(':entryId/move')
  @HttpCode(HttpStatus.OK)
  move(
    @CurrentMember() member: ClinicMemberContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
    @Body() body: MoveEntryDto,
  ): Promise<QueueEntry> {
    return this.commands.move(
      member.clinicId,
      entryId,
      {
        beforeEntryId: body.beforeEntryId ?? null,
        afterEntryId: body.afterEntryId ?? null,
      },
      { memberId: member.id },
    );
  }

}

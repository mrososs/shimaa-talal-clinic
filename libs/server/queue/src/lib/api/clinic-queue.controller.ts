import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { ClinicSessionService } from '@clinic/server-clinic';
import {
  UserRole,
  type ClinicSession,
  type QueueEntry,
} from '@clinic/contracts';
import { QueueCommandService } from '../queue-command.service';
import { QueueEntryService } from '../queue-entry.service';
import { QueueError, QueueErrorCode } from '../queue.errors';
import {
  CallNextDto,
  CancelEntryDto,
  EmergencyDto,
  MissDto,
  MoveEntryDto,
  QueueBoardQueryDto,
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
  constructor(
    private readonly entries: QueueEntryService,
    private readonly commands: QueueCommandService,
    private readonly sessions: ClinicSessionService,
  ) {}

  /**
   * The whole board, in service order.
   *
   * `since` is the revision the caller already holds. A five-second poll mostly
   * finds nothing new, and answering "unchanged" in a few bytes is what keeps
   * that cadence honest without a socket.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get()
  async board(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: QueueBoardQueryDto,
  ): Promise<QueueBoardResponse> {
    const session = await this.requireSession(member.clinicId, query.sessionId);

    if (query.since !== undefined && Number(query.since) === session.revision) {
      return { revision: session.revision, changed: false, session };
    }

    return {
      revision: session.revision,
      changed: true,
      session,
      entries: await this.entries.listForSession(session.id),
    };
  }

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

  private async requireSession(
    clinicId: string,
    sessionId: string,
  ): Promise<ClinicSession> {
    const session = await this.sessions.findById(clinicId, sessionId);
    if (session === null) {
      // A session at another clinic reads as "no such session".
      throw new QueueError(
        QueueErrorCode.EntryNotFound,
        'No such session at this clinic.',
      );
    }
    return session;
  }
}

/**
 * The board, or a note saying it has not moved.
 *
 * `changed: false` carries the session anyway — doctor presence and the pace
 * estimate live there, and a poll that learned nothing about them would make
 * the banner stale even while the queue itself was quiet.
 */
export interface QueueBoardResponse {
  revision: number;
  changed: boolean;
  session: ClinicSession;
  entries?: QueueEntry[];
}

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  CurrentGuardian,
  CurrentUser,
  Roles,
  type AuthenticatedUser,
  type GuardianContext,
} from '@clinic/server-core';
import { ClinicSessionService } from '@clinic/server-clinic';
import {
  QueueStatus,
  UserRole,
  type ParentQueueEntry,
  type ParentSessionView,
} from '@clinic/contracts';
import { QueueCommandService } from '../queue-command.service';
import { QueueEntryService } from '../queue-entry.service';
import { QueueError, QueueErrorCode } from '../queue.errors';
import { QueueExceptionFilter } from './queue-exception.filter';

/**
 * What a parent sees about their own children's turns.
 *
 * Note what this cannot return: another patient's name, another ticket number,
 * or the list. A parent gets a count and their own row. That is not a filter
 * someone could forget to apply — the shape itself has nowhere to put anyone
 * else, which is why `ParentQueueEntry` exists separately from `QueueEntry`.
 */
@Controller({ path: 'queue', version: '1' })
@UseFilters(QueueExceptionFilter)
export class MyQueueController {
  constructor(
    private readonly entries: QueueEntryService,
    private readonly commands: QueueCommandService,
    private readonly sessions: ClinicSessionService,
  ) {}

  /**
   * One item per child who is currently in a queue.
   *
   * Empty is the normal answer: most of the time nobody in the family is at the
   * clinic, and the app renders "not checked in" from that.
   */
  @Roles(UserRole.Guardian)
  @Get('me')
  async mine(
    @CurrentGuardian() guardian: GuardianContext,
  ): Promise<ParentQueueView[]> {
    const active = await this.entries.listActiveForGuardian(
      guardian.clinicId,
      guardian.id,
    );

    return Promise.all(
      active.map(async (entry) => {
        const session = await this.sessions.findById(
          guardian.clinicId,
          entry.sessionId,
        );

        return {
          childId: entry.childId,
          entry: {
            id: entry.id,
            ticketNumber: entry.ticketNumber,
            status: entry.status,
            aheadCount: await this.entries.aheadCount(entry.id),
            graceExpiresAt: entry.graceExpiresAt,
            deferCount: entry.deferCount,
            isEmergency: entry.isEmergency,
          },
          // The banner a parent reads before anything else: is the doctor here,
          // and is the queue actually moving.
          session:
            session === null
              ? null
              : {
                  status: session.status,
                  doctorPresence: session.doctorPresence,
                  delayMinutes: session.delayMinutes,
                  avgConsultMinutes: session.avgConsultMinutes,
                  revision: session.revision,
                },
        };
      }),
    );
  }

  /**
   * "Let the next person go."
   *
   * The only write a parent makes into the queue, capped by clinic policy and
   * only while still waiting — once called, the turn is happening.
   */
  @Roles(UserRole.Guardian)
  @Post(':entryId/defer')
  @HttpCode(HttpStatus.OK)
  async defer(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentGuardian() guardian: GuardianContext,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<ParentQueueEntry> {
    const entry = await this.entries.findById(guardian.clinicId, entryId);

    // Somebody else's entry answers exactly as an invented id does.
    if (entry === null || entry.guardianId !== guardian.id) {
      throw new QueueError(
        QueueErrorCode.EntryNotFound,
        'No such patient in the queue.',
      );
    }

    const deferred = await this.commands.defer(guardian.clinicId, entryId, {
      authUserId: user.id,
    });

    return {
      id: deferred.id,
      ticketNumber: deferred.ticketNumber,
      status: deferred.status as QueueStatus,
      aheadCount: await this.entries.aheadCount(deferred.id),
      graceExpiresAt: deferred.graceExpiresAt,
      deferCount: deferred.deferCount,
      isEmergency: deferred.isEmergency,
    };
  }
}

/** One child's place, plus the clinic state a parent needs to read it. */
export interface ParentQueueView {
  childId: string;
  entry: ParentQueueEntry;
  session: ParentSessionView | null;
}

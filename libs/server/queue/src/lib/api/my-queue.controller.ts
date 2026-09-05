import {
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
  CurrentUser,
  Roles,
  type AuthenticatedUser,
  type GuardianContext,
} from '@clinic/server-core';
import {
  QueueStatus,
  UserRole,
  type ParentQueueEntry,
} from '@clinic/contracts';
import { QueueCommandService } from '../queue-command.service';
import { QueueEntryService } from '../queue-entry.service';
import { QueueError, QueueErrorCode } from '../queue.errors';
import { QueueExceptionFilter } from './queue-exception.filter';

/**
 * The one write a parent makes into the queue.
 *
 * Reading their place is `GET /queue/me`, which is not here: it joins this
 * library with Booking, Patients and Clinic, so it is composed in
 * `@clinic/server-workflows`. Deferring touches nothing but a queue entry, so
 * it stays where the rule is.
 */
@Controller({ path: 'queue', version: '1' })
@UseFilters(QueueExceptionFilter)
export class MyQueueController {
  constructor(
    private readonly entries: QueueEntryService,
    private readonly commands: QueueCommandService,
  ) {}

  /**
   * "Let the next person go."
   *
   * Capped by clinic policy and only while still waiting — once called, the
   * turn is happening.
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
      calledAt: deferred.calledAt,
      graceExpiresAt: deferred.graceExpiresAt,
      // The estimate is a product rule about the clinic's state, and it is
      // assembled with the rest of the view rather than guessed at here.
      estimatedWaitMinutes: null,
      deferCount: deferred.deferCount,
      isEmergency: deferred.isEmergency,
    };
  }
}

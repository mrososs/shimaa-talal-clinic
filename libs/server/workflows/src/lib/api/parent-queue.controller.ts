import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  CurrentGuardian,
  Roles,
  type GuardianContext,
} from '@clinic/server-core';
import { QueueError, QueueErrorCode } from '@clinic/server-queue';
import { UserRole, type ParentQueueResponse } from '@clinic/contracts';
import { ParentQueueViewWorkflow } from '../parent-queue-view.workflow';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

export class ParentQueueQueryDto {
  /**
   * The revision the caller already holds.
   *
   * Omit it after the app has been in the background: coming back with a
   * revision from ten minutes ago would be answered "unchanged" against a queue
   * that has moved on without them.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since?: number;
}

/**
 * A parent's own children, and nothing else.
 *
 * It lives beside the staff board rather than in Queue for the same reason the
 * board does: it joins Queue, Booking, Patients and Clinic, and none of those
 * four may see the others.
 *
 * What it cannot return is the point. There is no clinic queue in this
 * response, no other patient's name, no other ticket number and no list to
 * filter — `ParentQueueItem` has nowhere to put one. The privacy property is
 * carried by the shape, not by a check somebody has to remember.
 */
@Controller({ path: 'queue', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class ParentQueueController {
  constructor(private readonly view: ParentQueueViewWorkflow) {}

  /**
   * One item per child with something happening today.
   *
   * An empty `items` is the ordinary answer, not an error: most of the time
   * nobody in the family is at the clinic, and the app renders "not checked in"
   * from exactly that.
   */
  @Roles(UserRole.Guardian)
  @Get('me')
  async mine(
    @CurrentGuardian() guardian: GuardianContext,
    @Query() query: ParentQueueQueryDto,
  ): Promise<ParentQueueResponse> {
    const view = await this.view.execute(
      { clinicId: guardian.clinicId, guardianId: guardian.id },
      query.since,
    );

    if (view === null) {
      throw new QueueError(
        QueueErrorCode.EntryNotFound,
        'This clinic is not currently active.',
      );
    }

    // An unchanged poll answers in two numbers rather than the whole view.
    if (query.since !== undefined && query.since === view.revision) {
      return { changed: false, revision: view.revision };
    }
    return view;
  }
}

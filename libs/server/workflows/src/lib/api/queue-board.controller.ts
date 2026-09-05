import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { ClinicSessionService } from '@clinic/server-clinic';
import { QueueError, QueueErrorCode } from '@clinic/server-queue';
import { UserRole, type QueueBoardResponse } from '@clinic/contracts';
import { ClinicQueueBoardWorkflow } from '../clinic-queue-board.workflow';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

export class QueueBoardQueryDto {
  @IsUUID()
  sessionId!: string;

  /**
   * The revision the caller already holds.
   *
   * Optional, and a caller that has just reconnected should omit it: coming
   * back with a revision from before a dropped connection would be answered
   * "unchanged" against a board that has moved on.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since?: number;
}

/**
 * The board, and the cheap answer when it has not moved.
 *
 * It lives in this library rather than in Queue because it is not a queue
 * query. The order comes from Queue, the names from Patients, and who is still
 * expected from Booking, and no one of those may reach the other two. Every
 * *command* stays in Queue, where the rules are.
 *
 * The path is unchanged, so nothing a client holds has to know any of this.
 */
@Controller({ path: 'clinic/queue', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
export class QueueBoardController {
  constructor(
    private readonly sessions: ClinicSessionService,
    private readonly board: ClinicQueueBoardWorkflow,
  ) {}

  /**
   * Any member may watch the day; the doctor's board is the same board.
   *
   * What a doctor may *do* with it is narrower, and that is enforced on each
   * command rather than by hiding the list — a read-only difference would be a
   * rule the UI keeps and the API does not.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get()
  async read(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: QueueBoardQueryDto,
  ): Promise<QueueBoardResponse> {
    const session = await this.sessions.findById(
      member.clinicId,
      query.sessionId,
    );
    if (session === null) {
      // A session at another clinic reads exactly as one that never existed.
      throw new QueueError(
        QueueErrorCode.EntryNotFound,
        'No such session at this clinic.',
      );
    }

    // Five seconds is a short time in a clinic, and most polls learn nothing.
    // Saying so in two numbers is what keeps that cadence honest without a
    // socket.
    if (query.since !== undefined && query.since === session.revision) {
      return { changed: false, revision: session.revision };
    }

    return this.board.execute(session);
  }
}

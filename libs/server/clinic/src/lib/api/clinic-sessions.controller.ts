import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import { UserRole, type ClinicSession } from '@clinic/contracts';
import { ClinicService } from '../clinic.service';
import { ClinicSessionService } from '../clinic-session.service';
import { ClinicError, ClinicErrorCode } from '../clinic.errors';
import { ClinicExceptionFilter } from './clinic-exception.filter';
import {
  DoctorPresenceDto,
  PaceDto,
  SessionsQueryDto,
} from './clinic-sessions.dto';

/**
 * The operational day: which sessions exist, and the handful of things staff
 * say about one while it runs.
 *
 * Every command here is a named route rather than a patch on a status field.
 * Pausing, closing and recording that the doctor is late are three different
 * decisions with three different consequences for the families watching their
 * phones, and a generic update would flatten them into one.
 *
 * Any active member may operate the day. The doctor pausing the queue between
 * patients and reception pausing it because the waiting room is full are the
 * same gesture, and making one of them ask the other would be a rule the clinic
 * has not asked for.
 */
@Controller({ path: 'clinic/sessions', version: '1' })
@UseFilters(ClinicExceptionFilter)
export class ClinicSessionsController {
  constructor(
    private readonly clinics: ClinicService,
    private readonly sessions: ClinicSessionService,
  ) {}

  /**
   * The sessions for a day, materialising them from the schedule if today is
   * the first time anyone has asked.
   *
   * A read that can write, deliberately. The alternative is a nightly job that
   * creates rows nobody may need, and a dashboard that shows an empty day
   * because the job did not run. `on conflict do nothing` makes concurrent
   * first-asks harmless, so the cost of this is one insert that usually
   * matches nothing.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Get()
  async list(
    @CurrentMember() member: ClinicMemberContext,
    @Query() query: SessionsQueryDto,
  ): Promise<ClinicSession[]> {
    const clinic = await this.clinics.findById(member.clinicId);
    if (clinic === null) {
      throw new ClinicError(
        ClinicErrorCode.ClinicNotFound,
        'This clinic is not currently active.',
      );
    }

    // "Today" belongs to the clinic, not to the server or the browser.
    return this.sessions.ensureForDate(
      member.clinicId,
      query.date ?? clinic.today,
    );
  }

  /** Start the day, or pick it up again after a pause. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':sessionId/open')
  @HttpCode(HttpStatus.OK)
  open(
    @CurrentMember() member: ClinicMemberContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ): Promise<ClinicSession> {
    return this.sessions.open(member.clinicId, sessionId);
  }

  /**
   * Stop calling patients without ending the day.
   *
   * The queue keeps everyone's place; nothing advances until it resumes, and
   * both apps say so rather than leaving families guessing.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':sessionId/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @CurrentMember() member: ClinicMemberContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ): Promise<ClinicSession> {
    return this.sessions.pause(member.clinicId, sessionId);
  }

  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':sessionId/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @CurrentMember() member: ClinicMemberContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ): Promise<ClinicSession> {
    return this.sessions.resume(member.clinicId, sessionId);
  }

  /** End the day. Final — a closed session does not reopen. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':sessionId/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentMember() member: ClinicMemberContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ): Promise<ClinicSession> {
    return this.sessions.close(member.clinicId, sessionId);
  }

  /**
   * Whether the doctor is here, and how far behind.
   *
   * The honest input to what a parent sees. An app that says "the doctor has
   * not arrived yet" is telling the truth; one that counts down to a turn that
   * cannot come is not.
   */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Post(':sessionId/doctor-presence')
  @HttpCode(HttpStatus.OK)
  presence(
    @CurrentMember() member: ClinicMemberContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: DoctorPresenceDto,
  ): Promise<ClinicSession> {
    return this.sessions.setDoctorPresence(member.clinicId, sessionId, {
      presence: body.presence,
      delayMinutes: body.delayMinutes ?? null,
      note: body.note ?? null,
    });
  }

  /** How long a consultation is actually taking today. */
  @Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
  @Patch(':sessionId/pace')
  pace(
    @CurrentMember() member: ClinicMemberContext,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: PaceDto,
  ): Promise<ClinicSession> {
    return this.sessions.setPace(
      member.clinicId,
      sessionId,
      body.avgConsultMinutes,
    );
  }
}

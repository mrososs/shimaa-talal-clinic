import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import {
  UserRole,
  type ClinicAuditEvent,
  type ClinicSettings,
} from '@clinic/contracts';
import { ClinicSettingsService } from '../clinic-settings.service';
class ProfileDto {
  @IsString() @Length(1, 200) name!: string;
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phoneE164?: string;
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @Length(3, 200)
  instapayHandle?: string;
}

function emptyToUndefined({ value }: { value: unknown }): unknown {
  return typeof value === 'string' && value.trim() === ''
    ? undefined
    : typeof value === 'string'
      ? value.trim()
      : value;
}
class PoliciesDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(120) gracePeriodMinutes!: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  defaultAvgConsultMinutes!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(10) maxSelfDefers!: number;
  @Type(() => Number) @IsInt() @Min(0) minLeadMinutes!: number;
  @Type(() => Number) @IsInt() @Min(0) cancellationCutoffMinutes!: number;
  @IsBoolean() autoConfirmParentBookings!: boolean;
}
class PriceDto {
  @Type(() => Number) @IsInt() @Min(0) amountMinor!: number;
  @IsBoolean() active!: boolean;
}
class TrackingDto {
  @IsBoolean() estimatorEnabled!: boolean;
  @IsBoolean() receptionVisible!: boolean;
  @IsBoolean() parentVisible!: boolean;
  @IsBoolean() guestEnabled!: boolean;
  @IsBoolean() attendanceEnabled!: boolean;
  @IsBoolean() fairnessEnabled!: boolean;
  @Type(() => Number) @IsInt() @Min(0) @Max(120) arrivalBufferMinutes!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(240) earlyCheckInMinutes!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(240) minimumTravelLeadMinutes!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(120) publicationThresholdMinutes!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(120) maxEarlierShiftMinutes!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(120)
  configuredBaselineMinutes?: number;
  @IsOptional() @IsBoolean() validateBaseline?: boolean;
  @IsOptional() @IsBoolean() approveParentEstimate?: boolean;
}
class TemplateDto {
  @IsString() @Length(1, 2000) body!: string;
  @IsBoolean() active!: boolean;
}
class ScheduleDto {
  @IsUUID() doctorMemberId!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsIn(['morning', 'evening']) sessionKind!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/) startsAt!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/) endsAt!: string;
  @Type(() => Number) @IsInt() @Min(5) @Max(240) windowMinutes!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) capacityPerWindow!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
}
class ClosureDto {
  @IsOptional() @IsUUID() doctorMemberId?: string;
  @IsISO8601() startsAt!: string;
  @IsISO8601() endsAt!: string;
  @IsString() @Length(1, 500) reason!: string;
}
class TeamDto {
  @IsString() @Length(1, 200) displayName!: string;
  @IsIn(['doctor', 'reception', 'admin']) role!: string;
  @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
}
@Controller({ path: 'clinic/settings', version: '1' })
@Roles(UserRole.Doctor, UserRole.Admin)
export class ClinicSettingsController {
  constructor(private readonly settings: ClinicSettingsService) {}
  @Get() read(
    @CurrentMember() m: ClinicMemberContext,
  ): Promise<ClinicSettings> {
    return this.settings.read(m.clinicId);
  }
  @Patch('profile') async profile(
    @CurrentMember() m: ClinicMemberContext,
    @Body() b: ProfileDto,
  ) {
    await this.settings.profile(m.clinicId, m.id, b);
    return this.settings.read(m.clinicId);
  }
  @Patch('policies') async policies(
    @CurrentMember() m: ClinicMemberContext,
    @Body() b: PoliciesDto,
  ) {
    await this.settings.policies(m.clinicId, m.id, b);
    return this.settings.read(m.clinicId);
  }
  @Patch('tracking') async tracking(
    @CurrentMember() m: ClinicMemberContext,
    @Body() b: TrackingDto,
  ) {
    await this.settings.tracking(m.clinicId, m.id, b);
    return this.settings.read(m.clinicId);
  }
  @Put('prices/:visitType') async price(
    @CurrentMember() m: ClinicMemberContext,
    @Param('visitType') v: string,
    @Body() b: PriceDto,
  ) {
    await this.settings.price(m.clinicId, m.id, v, b);
    return this.settings.read(m.clinicId);
  }
  @Put('notifications/:key') async template(
    @CurrentMember() m: ClinicMemberContext,
    @Param('key') k: string,
    @Body() b: TemplateDto,
  ) {
    await this.settings.template(m.clinicId, m.id, k, b);
    return this.settings.read(m.clinicId);
  }
  @Post('schedules') async schedule(
    @CurrentMember() m: ClinicMemberContext,
    @Body() b: ScheduleDto,
  ) {
    await this.settings.schedule(m.clinicId, m.id, b);
    return this.settings.read(m.clinicId);
  }
  @Post('closures') async closure(
    @CurrentMember() m: ClinicMemberContext,
    @Body() b: ClosureDto,
  ) {
    await this.settings.closure(m.clinicId, m.id, b);
    return this.settings.read(m.clinicId);
  }
  @Patch('team/:id') async team(
    @CurrentMember() m: ClinicMemberContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() b: TeamDto,
  ) {
    await this.settings.team(m.clinicId, m.id, id, b);
    return this.settings.read(m.clinicId);
  }
  @Get('audit') audit(
    @CurrentMember() m: ClinicMemberContext,
  ): Promise<ClinicAuditEvent[]> {
    return this.settings.audit(m.clinicId);
  }
}

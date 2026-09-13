import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Why a visit was called off.
 *
 * Optional, because a parent tapping "cancel" is not obliged to explain
 * themselves — but recorded whenever it is given, because reception reading
 * the day's list later usually wants to know.
 */
export class CancelReasonDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 280)
  reason?: string;
}

/** A session-scoped queue orchestration command. */
export class SessionQueueCommandDto {
  @IsUUID()
  sessionId!: string;
}

/** A server-owned availability window selected for a replacement visit. */
export class RescheduleAppointmentDto {
  @IsUUID()
  sessionId!: string;

  @IsISO8601({ strict: true })
  windowStart!: string;
}

export class MissQueueEntryDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ValidateIf((dto: MissQueueEntryDto) => dto.force === true)
  @IsString()
  @Transform(trim)
  @Length(1, 280)
  reason?: string;
}

export class CheckInAppointmentDto {
  @IsOptional()
  @IsBoolean()
  forceEarly?: boolean;

  @ValidateIf((dto: CheckInAppointmentDto) => dto.forceEarly === true)
  @IsString()
  @Transform(trim)
  @Length(1, 280)
  earlyReason?: string;
}

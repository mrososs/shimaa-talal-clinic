import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { DoctorPresence } from '@clinic/contracts';

/**
 * Request shapes for the operational day.
 *
 * The global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`,
 * so every accepted field appears here — and `clinicId` appears nowhere,
 * because it comes from the token.
 */

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SessionsQueryDto {
  /**
   * A clinic-local calendar date, not an instant.
   *
   * "Today" is a fact about Cairo, not about wherever the server happens to
   * run, so the client sends the day it means and the server resolves it in
   * the clinic's own timezone.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

export class DoctorPresenceDto {
  @IsIn(Object.values(DoctorPresence))
  presence!: DoctorPresence;

  /**
   * How far behind, when staff know.
   *
   * Only meaningful while the doctor is not here — arriving clears it, so
   * sending a delay alongside `arrived` is a contradiction rather than an
   * instruction.
   */
  @ValidateIf(
    (dto: DoctorPresenceDto) => dto.presence !== DoctorPresence.Arrived,
  )
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(480)
  delayMinutes?: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  note?: string;
}

export class PaceDto {
  /**
   * Staff's own estimate of how long a consultation is running today.
   *
   * Bounded because it feeds a waiting estimate a parent reads: a typo of 600
   * would quietly tell every family to come back tomorrow.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  avgConsultMinutes!: number;
}

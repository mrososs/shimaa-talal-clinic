import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

/**
 * Request shapes for the queue endpoints.
 *
 * The global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`,
 * so every accepted field appears here — and `clinicId` appears nowhere,
 * because it comes from the token.
 */

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** A patient with no booking. No appointment row is invented for them. */
export class WalkInDto {
  @IsUUID()
  sessionId!: string;

  @IsUUID()
  childId!: string;

  @IsOptional()
  @IsUUID()
  guardianId?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 280)
  visitReason?: string;
}

export class CancelEntryDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 280)
  reason?: string;
}

/**
 * Marking or clearing an emergency.
 *
 * The reason is required when marking and meaningless when clearing, which is
 * why the validation is conditional rather than simply optional: an emergency
 * nobody can explain later is the thing the audit trail exists to prevent.
 */
export class EmergencyDto {
  @IsBoolean()
  emergency!: boolean;

  @ValidateIf((dto: EmergencyDto) => dto.emergency)
  @IsString()
  @Transform(trim)
  @Length(1, 280)
  reason?: string;
}

/**
 * Where to put a patient: between two neighbours, or at one end.
 *
 * Both ids are optional at the transport boundary, but the domain requires at
 * least one and verifies the supplied neighbours inside the transaction.
 */
export class MoveEntryDto {
  @IsOptional()
  @IsUUID()
  beforeEntryId?: string;

  @IsOptional()
  @IsUUID()
  afterEntryId?: string;
}

import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import { AppointmentCancelledBy, VisitType } from '@clinic/contracts';

/**
 * Request shapes for the booking endpoints.
 *
 * The global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`,
 * so every field a request may carry appears here — and a `clinicId` appears
 * nowhere, which is what makes sending one a 400 rather than something a
 * controller has to remember to ignore.
 *
 * `guardianId` is absent for the same reason on the parent side: it comes from
 * the token. A parameter a client can set is a parameter a client can change.
 */

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const VISIT_TYPES = Object.values(VisitType);

/** `YYYY-MM-DD`, in the clinic's own timezone — never the caller's. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AvailabilityQueryDto {
  /** First clinic-local day to look at. Defaults to the clinic's today. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  /** Last day, inclusive. Defaults to a week from `date`. */
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/** Staff see full windows too, so they can tell a busy day from a closed one. */
export class StaffAvailabilityQueryDto extends AvailabilityQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeFull?: string;
}

export class CreateAppointmentDto {
  @IsUUID()
  childId!: string;

  @IsUUID()
  sessionId!: string;

  /** Exactly as availability reported it; the server checks it is a boundary. */
  @IsISO8601({ strict: true })
  windowStart!: string;

  @IsIn(VISIT_TYPES)
  visitType!: VisitType;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 500)
  notes?: string;
}

/**
 * Staff book on behalf of a family, so they name the guardian.
 *
 * The parent equivalent has no such field: theirs comes from the token.
 */
export class CreateClinicAppointmentDto extends CreateAppointmentDto {
  @IsUUID()
  guardianId!: string;
}

export class CancelAppointmentDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 280)
  reason?: string;
}

export class RescheduleAppointmentDto {
  @IsUUID()
  sessionId!: string;

  @IsISO8601({ strict: true })
  windowStart!: string;
}

export class AppointmentScopeQueryDto {
  @IsOptional()
  @IsIn(['upcoming', 'past'])
  scope?: 'upcoming' | 'past';
}

export class ClinicDayQueryDto {
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

/** Only ever `clinic` here — staff cancelling — but declared so it validates. */
export const CANCELLED_BY = Object.values(AppointmentCancelledBy);

import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Request shapes for the parent identity endpoints.
 *
 * The global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`,
 * so every accepted field must be declared here — an undeclared one is a 400,
 * not a silently ignored extra.
 *
 * Phone numbers are validated for *shape* only. Normalising them needs the
 * clinic's region, which a DTO cannot reach, so it happens one layer in where
 * the clinic is known. `normalizeToE164` is idempotent, so nothing is lost by
 * doing it there instead.
 */

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const RELATIONSHIPS = ['mother', 'father', 'grandparent', 'other'] as const;

export class CreateGuardianDto {
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  fullName!: string;

  /** Anything a person types; read against the clinic's region. */
  @IsString()
  @Transform(trim)
  @Length(6, 32)
  phone!: string;

  @IsOptional()
  @IsEmail()
  @Transform(trim)
  email?: string;

  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: (typeof RELATIONSHIPS)[number];
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(6, 32)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trim)
  email?: string;
}

export class ClaimRequestDto {
  @IsString()
  @Transform(trim)
  @Length(6, 32)
  phone!: string;
}

export class ClaimDto {
  @IsString()
  @Transform(trim)
  @Length(6, 32)
  phone!: string;

  /** Six digits, as issued. Verified against a keyed HMAC, never compared raw. */
  @IsString()
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code!: string;
}

export class CreateChildDto {
  @IsString()
  @Transform(trim)
  @Length(1, 120)
  @IsNotEmpty()
  fullName!: string;

  /** Often unknown when a parent registers, so optional here as in the schema. */
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['male', 'female'])
  sex?: 'male' | 'female';

  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: (typeof RELATIONSHIPS)[number];
}

export class UpdateChildDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 120)
  fullName?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['male', 'female'])
  sex?: 'male' | 'female';
}

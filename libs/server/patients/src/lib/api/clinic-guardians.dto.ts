import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MAX_PAGE_SIZE } from '@clinic/contracts';

/**
 * Request shapes for the staff identity endpoints.
 *
 * The global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`,
 * so every field a request may carry appears here. That is also the mechanism
 * that refuses a `clinicId` in a body: it is not declared, so sending one is a
 * 400 rather than something the controller has to remember to ignore.
 *
 * Phones are validated for shape only. Normalising one needs the clinic's
 * region, which a DTO cannot reach — the controller resolves the clinic and the
 * domain applies `@clinic/phone`, so the rule stays in one place and no
 * controller reimplements it.
 */

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const RELATIONSHIPS = ['mother', 'father', 'grandparent', 'other'] as const;

export class GuardianSearchQueryDto {
  /** Local or international; matched exactly once normalised. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(4, 32)
  phone?: string;

  /** Case-insensitive fragment of the guardian's name. */
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export class CreateClinicGuardianDto {
  @IsString()
  @Transform(trim)
  @Length(2, 120)
  fullName!: string;

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

export class UpdateClinicGuardianDto {
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

  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: (typeof RELATIONSHIPS)[number];
}

export class CreateClinicChildDto {
  @IsString()
  @Transform(trim)
  @Length(1, 120)
  fullName!: string;

  /** Often unknown when reception books over the phone, as in the schema. */
  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(['male', 'female'])
  sex?: 'male' | 'female';

  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: (typeof RELATIONSHIPS)[number];

  /** At most one guardian per child may be primary; the database enforces it. */
  @IsOptional()
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  isPrimary?: boolean;
}

/**
 * Identity fields only.
 *
 * Reception corrects a spelling or a date of birth. Anything clinical is a
 * medical record, which is not what this endpoint is for and not what this
 * platform stores.
 */
export class UpdateClinicChildDto {
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

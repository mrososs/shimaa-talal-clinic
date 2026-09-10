import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import type {
  CreateClinicalMeasurementInput,
  SaveClinicalEncounterInput,
} from '@clinic/contracts';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SaveClinicalEncounterDto implements SaveClinicalEncounterInput {
  @IsString()
  @Transform(trim)
  @Length(0, 20000)
  diagnosis!: string;

  @IsString()
  @Transform(trim)
  @Length(0, 20000)
  investigations!: string;

  @IsString()
  @Transform(trim)
  @Length(0, 20000)
  treatmentInstructions!: string;

  @IsString()
  @Transform(trim)
  @Length(0, 10000)
  growthObservation!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  followUpDays!: number | null;

  @IsString()
  @Transform(trim)
  @Length(0, 20000)
  parentSummary!: string;
}

export class CreateClinicalMeasurementDto implements CreateClinicalMeasurementInput {
  @IsOptional()
  @IsUUID()
  appointmentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.2)
  @Max(300)
  weightKg?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(250)
  heightCm?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(15)
  @Max(100)
  headCircumferenceCm?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(45)
  temperatureC?: number | null;
}

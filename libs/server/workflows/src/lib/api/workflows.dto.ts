import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

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

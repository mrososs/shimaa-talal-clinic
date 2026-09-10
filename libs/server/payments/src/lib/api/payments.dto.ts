import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterPaymentDto {
  @IsUUID() appointmentId!: string;
  @IsUUID() childId!: string;
  @IsUUID() guardianId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000_000) amountMinor!: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsUUID() idempotencyKey!: string;
}
export class RegisterParentPaymentDto {
  @IsUUID() appointmentId!: string;
  @IsUUID() idempotencyKey!: string;
}
export class PaymentDecisionDto {
  @IsOptional() @IsString() @Length(1, 2000) note?: string;
}

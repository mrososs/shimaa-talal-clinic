import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { AcceptUrgentCaseInput } from '@clinic/contracts';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AcceptUrgentCaseDto implements AcceptUrgentCaseInput {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 2000)
  decisionNote?: string | null;
}

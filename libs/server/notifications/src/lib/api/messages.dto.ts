import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type {
  CreateParentMessageThreadInput,
  CreateMessageThreadInput,
  DecideUrgentCaseInput,
  RaiseUrgentCaseInput,
  ReplyToThreadInput,
} from '@clinic/contracts';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class MessageInboxQueryDto {
  @IsOptional()
  @IsIn(['all', 'open', 'unread', 'urgent', 'assigned'])
  filter?: 'all' | 'open' | 'unread' | 'urgent' | 'assigned';
}

export class CreateMessageThreadDto implements CreateMessageThreadInput {
  @IsUUID() guardianId!: string;
  @IsUUID() childId!: string;
  @IsString() @Transform(trim) @Length(1, 200) contactName!: string;
  @IsString() @Transform(trim) @Length(1, 200) childName!: string;
  @IsString() @Transform(trim) @Length(1, 300) subject!: string;
  @IsString() @Transform(trim) @Length(1, 5000) initialMessage!: string;
}

export class CreateParentMessageThreadDto
  implements CreateParentMessageThreadInput
{
  @IsUUID() childId!: string;
  @IsString() @Transform(trim) @Length(1, 300) subject!: string;
  @IsString() @Transform(trim) @Length(1, 5000) initialMessage!: string;
  @IsUUID() clientRequestId!: string;
}

export class ReplyToThreadDto implements ReplyToThreadInput {
  @IsString() @Transform(trim) @Length(1, 5000) body!: string;
  @IsUUID() clientRequestId!: string;
}

export class RaiseUrgentCaseDto implements RaiseUrgentCaseInput {
  @IsString() @Transform(trim) @Length(1, 5000) triageNote!: string;
}

export class DecideUrgentCaseDto implements DecideUrgentCaseInput {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 2000)
  decisionNote?: string | null;
}

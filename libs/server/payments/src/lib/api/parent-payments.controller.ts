import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  UserRole,
  type ParentPaymentsView,
  type PaymentRecord,
} from '@clinic/contracts';
import {
  CurrentGuardian,
  Roles,
  type GuardianContext,
} from '@clinic/server-core';
import { PaymentService, type PaymentReceiptUpload } from '../payment.service';
import { RegisterParentPaymentDto } from './payments.dto';
import { PaymentsExceptionFilter } from './payments-exception.filter';

/** Guardian-owned payment choices; identity and price are always server-owned. */
@Controller({ path: 'payments', version: '1' })
@Roles(UserRole.Guardian)
@UseFilters(PaymentsExceptionFilter)
export class ParentPaymentsController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  list(
    @CurrentGuardian() guardian: GuardianContext,
  ): Promise<ParentPaymentsView> {
    return this.payments.parentView(guardian.clinicId, guardian.id);
  }

  @Post('cash')
  cash(
    @CurrentGuardian() guardian: GuardianContext,
    @Body() body: RegisterParentPaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.registerParentCash(
      guardian.clinicId,
      guardian.id,
      body,
    );
  }

  @Post('instapay')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    }),
  )
  instapay(
    @CurrentGuardian() guardian: GuardianContext,
    @Body() body: RegisterParentPaymentDto,
    @UploadedFile() file?: PaymentReceiptUpload,
  ): Promise<PaymentRecord> {
    return this.payments.registerParentInstapay(
      guardian.clinicId,
      guardian.id,
      { ...body, file },
    );
  }
}

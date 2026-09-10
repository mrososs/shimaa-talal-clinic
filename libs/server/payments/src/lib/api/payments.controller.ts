import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CurrentMember,
  Roles,
  type ClinicMemberContext,
} from '@clinic/server-core';
import {
  UserRole,
  type PaymentReceiptDownload,
  type PaymentRecord,
} from '@clinic/contracts';
import { PaymentService, type PaymentReceiptUpload } from '../payment.service';
import { PaymentDecisionDto, RegisterPaymentDto } from './payments.dto';
import { PaymentsExceptionFilter } from './payments-exception.filter';

@Controller({ path: 'clinic/payments', version: '1' })
@Roles(UserRole.Reception, UserRole.Admin, UserRole.Doctor)
@UseFilters(PaymentsExceptionFilter)
export class PaymentsController {
  constructor(private readonly payments: PaymentService) {}
  @Post('cash') cash(
    @CurrentMember() m: ClinicMemberContext,
    @Body() b: RegisterPaymentDto,
  ): Promise<PaymentRecord> {
    return this.payments.registerCash({
      ...b,
      clinicId: m.clinicId,
      memberId: m.id,
    });
  }
  @Post('instapay')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    }),
  )
  instapay(
    @CurrentMember() m: ClinicMemberContext,
    @Body() b: RegisterPaymentDto,
    @UploadedFile() file?: PaymentReceiptUpload,
  ): Promise<PaymentRecord> {
    return this.payments.registerInstapay({
      ...b,
      clinicId: m.clinicId,
      memberId: m.id,
      file,
    });
  }
  @Get(':id/receipt') receipt(
    @CurrentMember() m: ClinicMemberContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PaymentReceiptDownload> {
    return this.payments.receipt(m.clinicId, id);
  }
  @Post(':id/approve') approve(
    @CurrentMember() m: ClinicMemberContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() b: PaymentDecisionDto,
  ): Promise<PaymentRecord> {
    return this.payments.approve(m.clinicId, id, m.id, b.note ?? null);
  }
  @Post(':id/reject') reject(
    @CurrentMember() m: ClinicMemberContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() b: PaymentDecisionDto,
  ): Promise<PaymentRecord> {
    return this.payments.reject(m.clinicId, id, m.id, b.note ?? null);
  }
  @Post(':id/refund')
  @Roles(UserRole.Doctor, UserRole.Admin)
  refund(
    @CurrentMember() m: ClinicMemberContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() b: PaymentDecisionDto,
  ): Promise<PaymentRecord> {
    return this.payments.refund(m.clinicId, id, m.id, b.note ?? null);
  }
}

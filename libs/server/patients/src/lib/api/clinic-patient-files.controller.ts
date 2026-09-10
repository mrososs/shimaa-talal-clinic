import {
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
  type PatientFile,
  type PatientFileDownload,
} from '@clinic/contracts';
import {
  PatientFileService,
  type PatientFileUpload,
} from '../patient-file.service';
import { PatientsExceptionFilter } from './patients-exception.filter';

@Controller({ path: 'clinic/children/:childId/files', version: '1' })
@Roles(UserRole.Doctor, UserRole.Admin)
@UseFilters(PatientsExceptionFilter)
export class ClinicPatientFilesController {
  constructor(private readonly files: PatientFileService) {}

  @Get()
  list(
    @CurrentMember() member: ClinicMemberContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<PatientFile[]> {
    return this.files.list(member.clinicId, childId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(
    @CurrentMember() member: ClinicMemberContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @UploadedFile() file?: PatientFileUpload,
  ): Promise<PatientFile> {
    return this.files.upload({
      clinicId: member.clinicId,
      childId,
      memberId: member.id,
      file,
    });
  }

  @Get(':fileId/download')
  download(
    @CurrentMember() member: ClinicMemberContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<PatientFileDownload> {
    return this.files.download(member.clinicId, childId, fileId);
  }
}

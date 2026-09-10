import { Module } from '@nestjs/common';
import { ServerCoreModule } from '@clinic/server-core';
import { ClinicalService } from './clinical.service';

@Module({
  imports: [ServerCoreModule],
  providers: [ClinicalService],
  exports: [ClinicalService],
})
export class ClinicalModule {}

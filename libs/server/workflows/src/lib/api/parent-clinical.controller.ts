import { Controller, Get, Param, ParseUUIDPipe, UseFilters } from '@nestjs/common';
import { UserRole, type ParentGrowthView } from '@clinic/contracts';
import {
  CurrentGuardian,
  Roles,
  type GuardianContext,
} from '@clinic/server-core';
import { ClinicalWorkflow } from '../clinical.workflow';
import { WorkflowsExceptionFilter } from './workflows-exception.filter';

@Controller({ path: 'children', version: '1' })
@UseFilters(WorkflowsExceptionFilter)
@Roles(UserRole.Guardian)
export class ParentClinicalController {
  constructor(private readonly clinical: ClinicalWorkflow) {}

  @Get(':childId/growth')
  growth(
    @CurrentGuardian() guardian: GuardianContext,
    @Param('childId', new ParseUUIDPipe()) childId: string,
  ): Promise<ParentGrowthView> {
    return this.clinical.parentGrowth(
      guardian.clinicId,
      guardian.id,
      childId,
    );
  }
}

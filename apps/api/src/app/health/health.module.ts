import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Lives in the application rather than in a library on purpose: it reports on
 * *this deployment*, not on any business capability.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}

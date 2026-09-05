import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

/**
 * Architecture smoke test: the health endpoint answers, and answers in the
 * shape `@clinic/contracts` declares.
 */
describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('clinic-api');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});

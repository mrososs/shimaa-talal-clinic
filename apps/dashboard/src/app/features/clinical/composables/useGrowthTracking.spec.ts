import { describe, expect, it, vi } from 'vitest';
import type { ClinicApi } from '../../clinic/clinic.api';
import { useGrowthTracking } from './useGrowthTracking';

const measurement = {
  id: 'measurement-1',
  childId: 'child-1',
  appointmentId: null,
  weightKg: 15.2,
  heightCm: 101,
  headCircumferenceCm: null,
  temperatureC: null,
  measuredAt: '2026-09-09T10:00:00.000Z',
};

describe('useGrowthTracking', () => {
  it('loads history and prepends a newly recorded measurement', async () => {
    const created = { ...measurement, id: 'measurement-2', weightKg: 15.4 };
    const api = {
      measurements: vi.fn().mockResolvedValue([measurement]),
      addMeasurement: vi.fn().mockResolvedValue(created),
    } as unknown as ClinicApi;
    const growth = useGrowthTracking(api);

    await growth.load('child-1');
    growth.form.weightKg = 15.4;
    await expect(growth.add('child-1')).resolves.toBe(true);

    expect(api.addMeasurement).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({ weightKg: 15.4 }),
    );
    expect(growth.measurements.value.map(({ id }) => id)).toEqual([
      'measurement-2',
      'measurement-1',
    ]);
    expect(growth.form.weightKg).toBeNull();
  });
});

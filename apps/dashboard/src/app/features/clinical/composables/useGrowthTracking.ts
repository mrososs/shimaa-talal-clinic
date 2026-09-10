import { reactive, shallowRef } from 'vue';
import type {
  ClinicalMeasurement,
  CreateClinicalMeasurementInput,
} from '@clinic/contracts';
import { clinicApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';
import type { ClinicApi } from '../../clinic/clinic.api';

export function useGrowthTracking(api: ClinicApi = clinicApi) {
  const measurements = shallowRef<ClinicalMeasurement[]>([]);
  const loading = shallowRef(false);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const form = reactive<CreateClinicalMeasurementInput>({
    weightKg: null,
    heightCm: null,
    headCircumferenceCm: null,
  });

  async function load(childId: string): Promise<void> {
    loading.value = true;
    failure.value = null;
    try {
      measurements.value = await api.measurements(childId);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
    }
  }

  async function add(childId: string): Promise<boolean> {
    if (working.value) return false;
    working.value = true;
    failure.value = null;
    try {
      const measurement = await api.addMeasurement(childId, { ...form });
      measurements.value = [measurement, ...measurements.value];
      Object.assign(form, {
        weightKg: null,
        heightCm: null,
        headCircumferenceCm: null,
      });
      return true;
    } catch (error) {
      failure.value = apiMessage(error);
      return false;
    } finally {
      working.value = false;
    }
  }

  return { measurements, loading, working, failure, form, load, add };
}

import { reactive, shallowRef } from 'vue';
import type { SaveClinicalEncounterInput } from '@clinic/contracts';
import { clinicApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';
import type { ClinicApi } from '../../clinic/clinic.api';

const EMPTY: SaveClinicalEncounterInput = {
  diagnosis: '',
  investigations: '',
  treatmentInstructions: '',
  growthObservation: '',
  followUpDays: null,
  parentSummary: '',
};

export function useClinicalEncounter(api: ClinicApi = clinicApi) {
  const form = reactive<SaveClinicalEncounterInput>({ ...EMPTY });
  const record = shallowRef<Awaited<
    ReturnType<typeof clinicApi.clinicalRecord>
  > | null>(null);
  const loading = shallowRef(false);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);

  async function load(appointmentId: string): Promise<void> {
    loading.value = true;
    failure.value = null;
    try {
      record.value = await api.clinicalRecord(appointmentId);
      Object.assign(form, record.value.encounter ?? EMPTY);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
    }
  }

  async function save(appointmentId: string): Promise<boolean> {
    return run(() => api.saveClinicalDraft(appointmentId, { ...form }));
  }

  async function finalize(appointmentId: string): Promise<boolean> {
    return run(() => api.finalizeClinicalEncounter(appointmentId, { ...form }));
  }

  async function run(
    command: () => ReturnType<ClinicApi['saveClinicalDraft']>,
  ): Promise<boolean> {
    if (working.value) return false;
    working.value = true;
    failure.value = null;
    try {
      const encounter = await command();
      if (record.value) record.value = { ...record.value, encounter };
      return true;
    } catch (error) {
      failure.value = apiMessage(error);
      return false;
    } finally {
      working.value = false;
    }
  }

  return { form, record, loading, working, failure, load, save, finalize };
}

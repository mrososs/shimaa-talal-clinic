import { shallowRef } from 'vue';
import type { PatientFile } from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import type { ClinicApi } from '../../clinic/clinic.api';

export function usePatientFiles(api: ClinicApi) {
  const files = shallowRef<PatientFile[]>([]);
  const loading = shallowRef(false);
  const uploading = shallowRef(false);
  const failure = shallowRef<string | null>(null);

  async function load(childId: string): Promise<void> {
    loading.value = true;
    failure.value = null;
    files.value = [];
    try {
      files.value = await api.patientFiles(childId);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
    }
  }

  async function upload(childId: string, file: File): Promise<boolean> {
    if (uploading.value) return false;
    uploading.value = true;
    failure.value = null;
    try {
      const uploaded = await api.uploadPatientFile(childId, file);
      files.value = [uploaded, ...files.value];
      return true;
    } catch (error) {
      failure.value = apiMessage(error);
      return false;
    } finally {
      uploading.value = false;
    }
  }

  async function download(
    childId: string,
    fileId: string,
  ): Promise<string | null> {
    failure.value = null;
    try {
      return (await api.patientFileDownload(childId, fileId)).url;
    } catch (error) {
      failure.value = apiMessage(error);
      return null;
    }
  }

  function clear(): void {
    files.value = [];
    failure.value = null;
  }

  return { files, loading, uploading, failure, load, upload, download, clear };
}

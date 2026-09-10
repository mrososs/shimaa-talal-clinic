import { readonly, shallowRef } from 'vue';
import type { ClinicReport } from '@clinic/contracts';
import { reportsApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';
export function useReports() {
  const data = shallowRef<ClinicReport | null>(null),
    loading = shallowRef(true),
    failure = shallowRef<string | null>(null);
  async function load(from: string, to: string) {
    loading.value = true;
    try {
      data.value = await reportsApi.read(from, to);
      failure.value = null;
    } catch (e) {
      failure.value = apiMessage(e);
    } finally {
      loading.value = false;
    }
  }
  async function exportCsv(from: string, to: string) {
    try {
      const file = await reportsApi.export(from, to),
        url = URL.createObjectURL(
          new Blob([file.content], { type: file.mimeType }),
        ),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      failure.value = apiMessage(e);
    }
  }
  return {
    data: readonly(data),
    loading: readonly(loading),
    failure: readonly(failure),
    load,
    exportCsv,
  };
}

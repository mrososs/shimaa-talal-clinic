import { readonly, shallowRef } from 'vue';
import { usePolling } from '@clinic/client-ui';
import type { DashboardSummary } from '@clinic/contracts';
import { clinicApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';

const SUMMARY_POLL_MS = 30_000;

export function useDashboardSummary() {
  const summary = shallowRef<DashboardSummary | null>(null);
  const loading = shallowRef(true);
  const refreshing = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const selectedDate = shallowRef<string | undefined>();

  async function read(background = false): Promise<void> {
    if (background) refreshing.value = true;
    else loading.value = true;
    try {
      summary.value = await clinicApi.dashboardSummary(selectedDate.value);
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  }

  const polling = usePolling(() => read(true), {
    intervalMs: SUMMARY_POLL_MS,
    onResume: () => void read(true),
  });

  async function open(date?: string): Promise<void> {
    selectedDate.value = date;
    await read();
    polling.start();
  }

  return {
    summary: readonly(summary),
    loading: readonly(loading),
    refreshing: readonly(refreshing),
    failure: readonly(failure),
    open,
    refresh: () => read(true),
  };
}

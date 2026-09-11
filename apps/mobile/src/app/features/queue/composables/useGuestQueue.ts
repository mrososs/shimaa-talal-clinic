import { readonly, shallowRef } from 'vue';
import type { GuestQueueView } from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { queueApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';
import { QUEUE_POLL_MS } from './useLiveQueue';

export function useGuestQueue(token: () => string) {
  const view = shallowRef<GuestQueueView | null>(null);
  const loading = shallowRef(true);
  const refreshing = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const sequence = createSequence();

  async function read(): Promise<void> {
    const ticket = sequence.next();
    const next = await queueApi.guest(token());
    if (sequence.accept(ticket)) view.value = next;
  }

  async function refresh(): Promise<void> {
    refreshing.value = true;
    try {
      await read();
      failure.value = null;
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  }

  const polling = usePolling(
    async () => {
      try {
        await read();
        failure.value = null;
      } catch (error) {
        failure.value = apiMessage(error);
      }
    },
    { intervalMs: QUEUE_POLL_MS, onResume: () => void refresh() },
  );

  async function open(): Promise<void> {
    await refresh();
    if (view.value !== null) polling.start();
  }

  function close(): void {
    polling.stop();
  }

  return {
    view: readonly(view),
    loading: readonly(loading),
    refreshing: readonly(refreshing),
    failure: readonly(failure),
    polling,
    open,
    close,
    refresh,
  };
}

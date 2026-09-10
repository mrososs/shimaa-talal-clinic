import { computed, shallowRef } from 'vue';
import type { Appointment } from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { apiMessage } from '../../../shared/messages';
import { bookingApi } from '../../../runtime';

export const APPOINTMENTS_POLL_MS = 15_000;
export type AppointmentScope = 'upcoming' | 'past';

/**
 * Keeps the family's appointment list current without blanking it during a
 * background refresh. The server remains authoritative for approval and all
 * other states; the client only chooses which scope to read.
 */
export function useAppointments() {
  const scope = shallowRef<AppointmentScope>('upcoming');
  const items = shallowRef<Appointment[]>([]);
  const loading = shallowRef(true);
  const refreshing = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const updatedAt = shallowRef<number | null>(null);
  const sequence = createSequence();

  const empty = computed(() => !loading.value && items.value.length === 0);

  async function read(): Promise<void> {
    const ticket = sequence.next();
    const response = await bookingApi.list(scope.value);
    if (!sequence.accept(ticket)) return;
    items.value = response;
    updatedAt.value = Date.now();
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

  async function poll(): Promise<void> {
    try {
      await read();
      failure.value = null;
    } catch (error) {
      // Keep the last successful list visible; the banner makes its freshness
      // explicit instead of replacing useful data with an error screen.
      failure.value = apiMessage(error);
    }
  }

  const polling = usePolling(poll, {
    intervalMs: APPOINTMENTS_POLL_MS,
    onResume: () => void refresh(),
  });

  async function selectScope(next: AppointmentScope): Promise<void> {
    if (scope.value === next) return;
    scope.value = next;
    loading.value = items.value.length === 0;
    await refresh();
  }

  async function open(): Promise<void> {
    await refresh();
    polling.start();
  }

  function close(): void {
    polling.stop();
  }

  return {
    scope,
    items,
    loading,
    refreshing,
    failure,
    updatedAt,
    empty,
    polling,
    open,
    close,
    refresh,
    selectScope,
  };
}

export type AppointmentsState = ReturnType<typeof useAppointments>;

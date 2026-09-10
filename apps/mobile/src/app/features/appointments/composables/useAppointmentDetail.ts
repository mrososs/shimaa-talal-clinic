import { shallowRef } from 'vue';
import type { Appointment } from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { apiMessage } from '../../../shared/messages';
import { bookingApi } from '../../../runtime';
import { APPOINTMENTS_POLL_MS } from './useAppointments';

/** Live state for one appointment, including parent cancellation. */
export function useAppointmentDetail(appointmentId: () => string) {
  const appointment = shallowRef<Appointment | null>(null);
  const loading = shallowRef(true);
  const refreshing = shallowRef(false);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const sequence = createSequence();

  async function read(): Promise<void> {
    const ticket = sequence.next();
    const response = await bookingApi.detail(appointmentId());
    if (!sequence.accept(ticket)) return;
    appointment.value = response;
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
      failure.value = apiMessage(error);
    }
  }

  const polling = usePolling(poll, {
    intervalMs: APPOINTMENTS_POLL_MS,
    onResume: () => void refresh(),
  });

  async function cancel(reason?: string): Promise<boolean> {
    const current = appointment.value;
    if (current === null || working.value) return false;
    const ticket = sequence.next();
    working.value = true;
    failure.value = null;
    try {
      const response = await bookingApi.cancel(current.id, reason);
      if (sequence.accept(ticket)) appointment.value = response;
      return true;
    } catch (error) {
      sequence.accept(ticket);
      failure.value = apiMessage(error);
      await read().catch(() => undefined);
      return false;
    } finally {
      working.value = false;
    }
  }

  async function open(): Promise<void> {
    await refresh();
    polling.start();
  }

  function close(): void {
    polling.stop();
  }

  return {
    appointment,
    loading,
    refreshing,
    working,
    failure,
    polling,
    open,
    close,
    refresh,
    cancel,
  };
}

export type AppointmentDetailState = ReturnType<typeof useAppointmentDetail>;

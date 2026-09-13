import { shallowRef } from 'vue';
import {
  AttendanceIntent,
  type Appointment,
  type AppointmentTrackingView,
} from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { apiMessage } from '../../../shared/messages';
import { bookingApi } from '../../../runtime';

/** Live state for one appointment, including parent cancellation. */
export function useAppointmentDetail(appointmentId: () => string) {
  const appointment = shallowRef<Appointment | null>(null);
  const tracking = shallowRef<AppointmentTrackingView | null>(null);
  const loading = shallowRef(true);
  const refreshing = shallowRef(false);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const sequence = createSequence();

  async function read(): Promise<void> {
    const ticket = sequence.next();
    const [response, trackingResponse] = await Promise.all([
      bookingApi.detail(appointmentId()),
      bookingApi.tracking(appointmentId()),
    ]);
    if (!sequence.accept(ticket)) return;
    appointment.value = response;
    tracking.value = trackingResponse;
  }

  async function setAttendance(
    intent: typeof AttendanceIntent.Coming | typeof AttendanceIntent.NotComing,
  ): Promise<void> {
    if (!navigator.onLine || working.value) return;
    working.value = true;
    failure.value = null;
    try {
      tracking.value = await bookingApi.attendance(appointmentId(), intent);
      if (appointment.value) {
        appointment.value = { ...appointment.value, attendanceIntent: intent,
          attendanceIntentSetAt: new Date().toISOString() };
      }
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      working.value = false;
    }
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
    intervalMs: () => trackingPollInterval(tracking.value),
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
    tracking,
    loading,
    refreshing,
    working,
    failure,
    polling,
    open,
    close,
    refresh,
    cancel,
    setAttendance,
  };
}

function trackingPollInterval(view: AppointmentTrackingView | null): number {
  if (view?.queue !== null && view?.queue !== undefined) return 5_000;
  if (view?.appointmentStatus === 'confirmed') return 30_000;
  return 60_000;
}

export type AppointmentDetailState = ReturnType<typeof useAppointmentDetail>;

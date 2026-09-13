import { readonly, shallowRef } from 'vue';
import {
  AttendanceIntent,
  type AppointmentTrackingView,
} from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { bookingApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';

export function useGuestAppointmentTracking(token: () => string) {
  const view = shallowRef<AppointmentTrackingView | null>(null);
  const loading = shallowRef(true);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const sequence = createSequence();
  async function read() {
    const ticket = sequence.next();
    const result = await bookingApi.guestTracking(token());
    if (sequence.accept(ticket)) view.value = result;
  }
  async function refresh() {
    try { await read(); failure.value = null; }
    catch (error) { failure.value = apiMessage(error); }
    finally { loading.value = false; }
  }
  const polling = usePolling(async () => {
    try { await read(); failure.value = null; }
    catch (error) { failure.value = apiMessage(error); }
  }, {
    intervalMs: () => view.value?.queue ? 5_000 :
      view.value?.appointmentStatus === 'confirmed' ? 30_000 : 60_000,
    onResume: () => void refresh(),
  });
  async function open() { await refresh(); if (view.value) polling.start(); }
  function close() { polling.stop(); }
  async function setAttendance(
    intent: typeof AttendanceIntent.Coming | typeof AttendanceIntent.NotComing,
  ) {
    if (!navigator.onLine || working.value) return;
    working.value = true;
    failure.value = null;
    try { view.value = await bookingApi.guestAttendance(token(), intent); }
    catch (error) { failure.value = apiMessage(error); }
    finally { working.value = false; }
  }
  return { view: readonly(view), loading: readonly(loading),
    working: readonly(working), failure: readonly(failure), open, close,
    refresh, setAttendance };
}

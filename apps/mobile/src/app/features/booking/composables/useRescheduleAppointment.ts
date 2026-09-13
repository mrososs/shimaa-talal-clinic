import { computed, shallowRef } from 'vue';
import type {
  Appointment,
  AvailabilityDay,
  AvailabilityWindow,
  RescheduledAppointment,
} from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { bookingApi, config } from '../../../runtime';

export function useRescheduleAppointment(appointmentId: () => string) {
  const appointment = shallowRef<Appointment | null>(null);
  const days = shallowRef<AvailabilityDay[]>([]);
  const selectedDate = shallowRef<string | null>(null);
  const selectedWindow = shallowRef<AvailabilityWindow | null>(null);
  const loading = shallowRef(true);
  const submitting = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const replacement = shallowRef<RescheduledAppointment | null>(null);
  const rotatedTrackingLink = shallowRef<string | null>(null);

  const windowsForDay = computed(() => {
    const current = appointment.value;
    const windows =
      days.value.find((day) => day.date === selectedDate.value)?.windows ?? [];
    return windows.filter(
      (window) =>
        current === null ||
        window.sessionId !== current.sessionId ||
        window.windowStart !== current.windowStart,
    );
  });

  const canSubmit = computed(
    () => selectedWindow.value !== null && !submitting.value,
  );

  async function load(): Promise<void> {
    loading.value = true;
    failure.value = null;
    try {
      const [current, availability] = await Promise.all([
        bookingApi.detail(appointmentId()),
        bookingApi.availability(),
      ]);
      appointment.value = current;
      days.value = availability;
      selectedDate.value ??= availability.find((day) =>
        day.windows.some(
          (window) =>
            window.sessionId !== current.sessionId ||
            window.windowStart !== current.windowStart,
        ),
      )?.date ?? null;
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      loading.value = false;
    }
  }

  function pickDay(date: string): void {
    selectedDate.value = date;
    selectedWindow.value = null;
  }

  async function submit(): Promise<RescheduledAppointment | null> {
    const current = appointment.value;
    const target = selectedWindow.value;
    if (current === null || target === null || submitting.value) return null;
    submitting.value = true;
    failure.value = null;
    try {
      const result = await bookingApi.reschedule(current.id, {
        sessionId: target.sessionId,
        windowStart: target.windowStart,
      });
      replacement.value = result;
      rotatedTrackingLink.value = result.trackingLinkRotation
        ? `${config.mobileAppUrl.replace(/\/$/, '')}/track#${result.trackingLinkRotation.token}`
        : null;
      return result;
    } catch (error) {
      const message = apiMessage(error);
      selectedWindow.value = null;
      await load();
      failure.value = message;
      return null;
    } finally {
      submitting.value = false;
    }
  }

  return {
    appointment,
    days,
    selectedDate,
    selectedWindow,
    loading,
    submitting,
    failure,
    replacement,
    rotatedTrackingLink,
    windowsForDay,
    canSubmit,
    load,
    pickDay,
    submit,
  };
}

export type RescheduleAppointmentState = ReturnType<
  typeof useRescheduleAppointment
>;

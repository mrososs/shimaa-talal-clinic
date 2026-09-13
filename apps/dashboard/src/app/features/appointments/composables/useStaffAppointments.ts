import { ref } from 'vue';
import { createSequence, usePolling } from '@clinic/client-ui';
import type { AppointmentListItem } from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { clinicApi } from '../../../runtime';

/**
 * The desk works from this screen all day, so a request a parent sends has to
 * land on it without anybody navigating. Ten seconds is the operational beat:
 * fast enough that a family at the counter is not waiting on a refresh, slow
 * enough that a board left open overnight costs the clinic nothing.
 */
export const APPOINTMENTS_POLL_MS = 10_000;

/** Both ends are optional: the API defaults to the clinic's own today. */
export interface AppointmentRange {
  from?: string;
  to?: string;
}

/**
 * The clinic's day, kept current.
 *
 * This screen used to read once on mount and then go silent: a booking made by
 * a parent while reception sat on it never appeared, because nothing ever asked
 * again. The queue board already had the lifecycle this needs, so it uses the
 * same one rather than a second interval of its own.
 *
 * The range stays with the caller — day, week and month are a presentation
 * choice, and this has no opinion about them.
 */
export function useStaffAppointments(range: () => AppointmentRange) {
  const items = ref<AppointmentListItem[]>([]);
  const loading = ref(true);
  const failure = ref<string | null>(null);

  /**
   * Stops a tick that was sent first and landed second from describing the day
   * as it was before an approval the receptionist has already seen applied.
   */
  const sequence = createSequence();

  /**
   * `background` is the whole distinction between the two callers.
   *
   * The first read owns the loading state and may legitimately show an empty
   * table. A poll never does either: a tick that fails keeps the rows already
   * on the screen, because somebody is reading them and a momentary network
   * fault is not news the desk needs.
   */
  async function read(background: boolean): Promise<void> {
    if (!background) {
      loading.value = true;
      failure.value = null;
    }
    const ticket = sequence.next();
    try {
      const { from, to } = range();
      const next = await clinicApi.appointments(from, to);
      if (!sequence.accept(ticket)) return;
      items.value = next;
      // A poll that succeeds clears a failure the previous one reported: the
      // connection came back, and leaving the banner up would be a lie.
      failure.value = null;
    } catch (error) {
      if (!background) failure.value = apiMessage(error);
    } finally {
      if (!background) loading.value = false;
    }
  }

  const load = (): Promise<void> => read(false);
  const refresh = (): Promise<void> => read(true);

  // One loop, paused while the tab is hidden, and a full read on return rather
  // than trusting what the table held when somebody looked away.
  const polling = usePolling(() => read(true), {
    intervalMs: APPOINTMENTS_POLL_MS,
    onResume: () => void refresh(),
  });

  return { items, loading, failure, load, refresh, polling };
}

export type StaffAppointmentsState = ReturnType<typeof useStaffAppointments>;

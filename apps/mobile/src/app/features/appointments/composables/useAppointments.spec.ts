import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AttendanceIntent,
  type Appointment,
  type AppointmentTrackingView,
} from '@clinic/contracts';

const api = {
  list: vi.fn(),
  detail: vi.fn(),
  tracking: vi.fn(),
  cancel: vi.fn(),
};
vi.mock('../../../runtime', () => ({ bookingApi: api }));

const { APPOINTMENTS_POLL_MS, useAppointments } =
  await import('./useAppointments');
const { useAppointmentDetail } = await import('./useAppointmentDetail');

function appointment(
  status: Appointment['status'] = 'requested',
  id = 'appointment-1',
): Appointment {
  return {
    id,
    clinicId: 'clinic-1',
    sessionId: 'session-1',
    childId: 'child-1',
    guardianId: 'guardian-1',
    windowStart: '2026-09-12T10:00:00.000Z',
    windowEnd: '2026-09-12T11:00:00.000Z',
    visitType: 'new_visit',
    status,
    attendanceIntent: AttendanceIntent.Unknown,
    attendanceIntentSetAt: null,
    notes: null,
    createdByMemberId: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    rescheduledFromAppointmentId: null,
    createdAt: '2026-09-10T10:00:00.000Z',
  };
}

function tracking(status: Appointment['status'] = 'requested'): AppointmentTrackingView {
  return {
    appointmentId: 'appointment-1',
    appointmentStatus: status,
    windowStart: '2026-09-12T10:00:00.000Z',
    windowEnd: '2026-09-12T11:00:00.000Z',
    estimate: null,
    unavailableReason: null,
    attendanceIntent: AttendanceIntent.Unknown,
    attendanceEnabled: false,
    queue: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useAppointments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([appointment()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountList() {
    const scope = effectScope();
    const state = scope.run(() => useAppointments());
    if (state === undefined) throw new Error('scope did not run');
    return { state, dispose: () => scope.stop() };
  }

  it('loads the upcoming list immediately and starts one mobile poll', async () => {
    const { state, dispose } = mountList();

    await state.open();

    expect(api.list).toHaveBeenCalledWith('upcoming');
    expect(state.items.value[0]?.status).toBe('requested');
    expect(state.loading.value).toBe(false);
    expect(state.polling.active.value).toBe(true);
    dispose();
  });

  it('shows a reception approval on the next poll without blanking the list', async () => {
    vi.useFakeTimers();
    const { state, dispose } = mountList();
    await state.open();
    api.list.mockResolvedValue([appointment('confirmed')]);

    const tick = vi.advanceTimersByTimeAsync(APPOINTMENTS_POLL_MS);
    expect(state.loading.value).toBe(false);
    expect(state.items.value[0]?.status).toBe('requested');
    await tick;

    expect(state.items.value[0]?.status).toBe('confirmed');
    dispose();
  });

  it('does not let an older response undo a newer approval', async () => {
    const oldPoll = deferred<Appointment[]>();
    const { state, dispose } = mountList();
    await state.open();
    api.list.mockReturnValueOnce(oldPoll.promise);
    const polling = state.refresh();
    api.list.mockResolvedValueOnce([appointment('confirmed')]);
    await state.refresh();

    oldPoll.resolve([appointment('requested')]);
    await polling;

    expect(state.items.value[0]?.status).toBe('confirmed');
    dispose();
  });

  it('switches to past appointments through one explicit action', async () => {
    const { state, dispose } = mountList();
    await state.open();
    api.list.mockResolvedValueOnce([appointment('completed')]);

    await state.selectScope('past');

    expect(api.list).toHaveBeenLastCalledWith('past');
    expect(state.scope.value).toBe('past');
    expect(state.items.value[0]?.status).toBe('completed');
    dispose();
  });

  it('keeps the last successful list when a background read fails', async () => {
    const { state, dispose } = mountList();
    await state.open();
    api.list.mockRejectedValueOnce(new Error('offline'));

    await state.refresh();

    expect(state.items.value).toHaveLength(1);
    expect(state.failure.value).toBeTruthy();
    dispose();
  });
});

describe('useAppointmentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.detail.mockResolvedValue(appointment());
    api.tracking.mockResolvedValue(tracking());
    api.cancel.mockResolvedValue({
      ...appointment('cancelled'),
      cancelledBy: 'parent',
    });
  });

  function mountDetail() {
    const scope = effectScope();
    const state = scope.run(() =>
      useAppointmentDetail(() => 'appointment-1'),
    );
    if (state === undefined) throw new Error('scope did not run');
    return { state, dispose: () => scope.stop() };
  }

  it('updates the open detail after the clinic changes its status', async () => {
    const { state, dispose } = mountDetail();
    await state.open();
    api.detail.mockResolvedValueOnce(appointment('confirmed'));
    api.tracking.mockResolvedValueOnce(tracking('confirmed'));

    await state.refresh();

    expect(state.appointment.value?.status).toBe('confirmed');
    dispose();
  });

  it('applies a parent cancellation and prevents duplicate taps', async () => {
    const command = deferred<Appointment>();
    const { state, dispose } = mountDetail();
    await state.open();
    api.cancel.mockReturnValueOnce(command.promise);

    const first = state.cancel();
    const second = await state.cancel();
    expect(second).toBe(false);
    expect(api.cancel).toHaveBeenCalledTimes(1);

    command.resolve(appointment('cancelled'));
    expect(await first).toBe(true);
    expect(state.appointment.value?.status).toBe('cancelled');
    dispose();
  });
});

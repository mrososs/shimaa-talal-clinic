import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

const appointments = vi.fn();
vi.mock('../../../runtime', () => ({ clinicApi: { appointments } }));

const { APPOINTMENTS_POLL_MS, useStaffAppointments } = await import(
  './useStaffAppointments'
);

/**
 * The screen reception works from all day used to read once on mount and then
 * go silent, so a booking a parent made never appeared until somebody navigated
 * away and back. These pin the lifecycle it was missing.
 */

const row = (id: string) => ({ id }) as never;

function run<T>(body: () => T): { value: T; dispose: () => void } {
  const scope = effectScope();
  const value = scope.run(body) as T;
  return { value, dispose: () => scope.stop() };
}

describe('useStaffAppointments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appointments.mockReset();
    appointments.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps asking without anybody navigating', async () => {
    const { value: state, dispose } = run(() =>
      useStaffAppointments(() => ({ from: '2026-09-13' })),
    );

    await state.load();
    expect(appointments).toHaveBeenCalledTimes(1);

    appointments.mockResolvedValue([row('new-request')]);
    state.polling.start();
    await vi.advanceTimersByTimeAsync(APPOINTMENTS_POLL_MS);

    expect(appointments).toHaveBeenCalledTimes(2);
    expect(state.items.value).toEqual([{ id: 'new-request' }]);
    dispose();
  });

  it('runs one loop however often it is started', async () => {
    const { value: state, dispose } = run(() =>
      useStaffAppointments(() => ({ from: '2026-09-13' })),
    );

    state.polling.start();
    state.polling.start();
    state.polling.start();
    await vi.advanceTimersByTimeAsync(APPOINTMENTS_POLL_MS);

    expect(appointments).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('stops asking once the screen is gone', async () => {
    const { value: state, dispose } = run(() =>
      useStaffAppointments(() => ({ from: '2026-09-13' })),
    );

    state.polling.start();
    await vi.advanceTimersByTimeAsync(APPOINTMENTS_POLL_MS);
    expect(appointments).toHaveBeenCalledTimes(1);

    dispose();
    await vi.advanceTimersByTimeAsync(APPOINTMENTS_POLL_MS * 3);

    expect(appointments).toHaveBeenCalledTimes(1);
  });

  it('never blanks a table somebody is reading', async () => {
    const { value: state, dispose } = run(() =>
      useStaffAppointments(() => ({ from: '2026-09-13' })),
    );

    appointments.mockResolvedValue([row('a1')]);
    await state.load();
    expect(state.items.value).toEqual([{ id: 'a1' }]);

    appointments.mockRejectedValue(new Error('network'));
    await state.refresh();

    // The rows stay, the loading state is not re-entered, and a failed tick is
    // not reported as though the desk had asked for something.
    expect(state.items.value).toEqual([{ id: 'a1' }]);
    expect(state.loading.value).toBe(false);
    expect(state.failure.value).toBeNull();
    dispose();
  });

  it('reports a failure the desk actually asked for', async () => {
    const { value: state, dispose } = run(() =>
      useStaffAppointments(() => ({ from: '2026-09-13' })),
    );

    appointments.mockRejectedValue(new Error('network'));
    await state.load();

    expect(state.failure.value).not.toBeNull();
    expect(state.loading.value).toBe(false);
    dispose();
  });

  it('refuses an answer that arrives after a newer one', async () => {
    const { value: state, dispose } = run(() =>
      useStaffAppointments(() => ({ from: '2026-09-13' })),
    );

    let releaseSlow: (rows: unknown[]) => void = () => undefined;
    appointments.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseSlow = resolve as (rows: unknown[]) => void;
      }),
    );
    const slow = state.refresh();

    appointments.mockResolvedValueOnce([row('newer')]);
    await state.refresh();
    expect(state.items.value).toEqual([{ id: 'newer' }]);

    // The stale response lands last and must not put the old day back.
    releaseSlow([row('older')]);
    await slow;

    expect(state.items.value).toEqual([{ id: 'newer' }]);
    dispose();
  });
});

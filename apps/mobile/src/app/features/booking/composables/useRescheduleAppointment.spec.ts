import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment, AvailabilityDay } from '@clinic/contracts';

const api = {
  detail: vi.fn(),
  availability: vi.fn(),
  reschedule: vi.fn(),
};
vi.mock('../../../runtime', () => ({ bookingApi: api }));

const { useRescheduleAppointment } =
  await import('./useRescheduleAppointment');

const current = {
  id: 'appointment-1',
  sessionId: 'session-1',
  windowStart: '2026-09-12T10:00:00.000Z',
  windowEnd: '2026-09-12T11:00:00.000Z',
  status: 'confirmed',
} as Appointment;

const days: AvailabilityDay[] = [
  {
    date: '2026-09-12',
    windows: [
      {
        sessionId: 'session-1',
        windowStart: current.windowStart,
        windowEnd: current.windowEnd,
        capacity: 5,
        booked: 1,
        remaining: 4,
      },
      {
        sessionId: 'session-1',
        windowStart: '2026-09-12T11:00:00.000Z',
        windowEnd: '2026-09-12T12:00:00.000Z',
        capacity: 5,
        booked: 0,
        remaining: 5,
      },
    ],
  },
];

function mount() {
  const scope = effectScope();
  const form = scope.run(() =>
    useRescheduleAppointment(() => 'appointment-1'),
  );
  if (form === undefined) throw new Error('scope did not run');
  return { form, dispose: () => scope.stop() };
}

describe('useRescheduleAppointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.detail.mockResolvedValue(current);
    api.availability.mockResolvedValue(days);
    api.reschedule.mockResolvedValue({
      ...current,
      id: 'appointment-2',
      windowStart: days[0].windows[1].windowStart,
      windowEnd: days[0].windows[1].windowEnd,
    });
  });

  it('never offers the exact current window as a change', async () => {
    const { form, dispose } = mount();

    await form.load();

    expect(form.windowsForDay.value).toHaveLength(1);
    expect(form.windowsForDay.value[0]?.windowStart).toBe(
      '2026-09-12T11:00:00.000Z',
    );
    dispose();
  });

  it('sends only the server-owned target session and window', async () => {
    const { form, dispose } = mount();
    await form.load();
    form.selectedWindow.value = form.windowsForDay.value[0] ?? null;

    const result = await form.submit();

    expect(api.reschedule).toHaveBeenCalledWith('appointment-1', {
      sessionId: 'session-1',
      windowStart: '2026-09-12T11:00:00.000Z',
    });
    expect(result?.id).toBe('appointment-2');
    dispose();
  });

  it('refreshes capacity after losing a race for the target window', async () => {
    const { form, dispose } = mount();
    await form.load();
    form.selectedWindow.value = form.windowsForDay.value[0] ?? null;
    api.reschedule.mockRejectedValueOnce(new Error('full'));

    await expect(form.submit()).resolves.toBeNull();

    expect(api.availability).toHaveBeenCalledTimes(2);
    expect(form.selectedWindow.value).toBeNull();
    expect(form.failure.value).toBeTruthy();
    dispose();
  });
});

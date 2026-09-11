import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClinicSessionStatus,
  DoctorPresence,
  QueueStatus,
} from '@clinic/contracts';

const api = { guest: vi.fn() };
vi.mock('../../../runtime', () => ({ queueApi: api }));

const { useGuestQueue } = await import('./useGuestQueue');

const view = {
  ticketNumber: 24,
  status: QueueStatus.Waiting,
  aheadCount: 2,
  nowServingTicketNumber: 21,
  graceExpiresAt: null,
  sessionStatus: ClinicSessionStatus.Open,
  doctorPresence: DoctorPresence.Arrived,
  delayMinutes: null,
  revision: 8,
  expiresAt: '2026-09-11T21:00:00.000Z',
};

describe('useGuestQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.guest.mockResolvedValue(view);
  });

  it('reads the capability immediately and starts mobile polling', async () => {
    const scope = effectScope();
    const state = scope.run(() => useGuestQueue(() => 'guest-token'))!;

    await state.open();

    expect(api.guest).toHaveBeenCalledWith('guest-token');
    expect(state.view.value).toEqual(view);
    expect(state.polling.active.value).toBe(true);
    scope.stop();
  });

  it('keeps the last good view when a refresh fails', async () => {
    const scope = effectScope();
    const state = scope.run(() => useGuestQueue(() => 'guest-token'))!;
    await state.open();
    api.guest.mockRejectedValueOnce(new Error('offline'));

    await state.refresh();

    expect(state.view.value).toEqual(view);
    expect(state.failure.value).not.toBeNull();
    scope.stop();
  });
});

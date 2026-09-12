import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParentNotificationsView } from '@clinic/contracts';

const api = {
  list: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
};
vi.mock('../../../runtime', () => ({ notificationsApi: api }));

const { useParentNotifications } = await import(
  './useParentNotifications'
);

const notification = (readAt: string | null = null) => ({
  id: 'notification-1',
  kind: 'payment_approved' as const,
  title: 'تم اعتماد الدفع',
  body: 'أكدت العيادة استلام الدفعة بنجاح.',
  deepLink: '/payments?appointmentId=appointment-1',
  readAt,
  createdAt: '2026-09-12T10:00:00.000Z',
});

function view(readAt: string | null = null): ParentNotificationsView {
  return {
    items: [notification(readAt)],
    unreadCount: readAt === null ? 1 : 0,
  };
}

function mount() {
  const scope = effectScope();
  const state = scope.run(() => useParentNotifications());
  if (!state) throw new Error('scope did not run');
  return { state, dispose: () => scope.stop() };
}

describe('useParentNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue(view());
    api.markRead.mockResolvedValue(
      notification('2026-09-12T10:05:00.000Z'),
    );
    api.markAllRead.mockResolvedValue(undefined);
  });

  it('loads unread state and starts the 15-second poller', async () => {
    const { state, dispose } = mount();

    await state.open();

    expect(state.unreadCount.value).toBe(1);
    expect(state.hasUnread.value).toBe(true);
    expect(state.polling.active.value).toBe(true);
    dispose();
  });

  it('marks one item locally after the API confirms it', async () => {
    const { state, dispose } = mount();
    await state.open();

    await state.markRead(state.items.value[0]);

    expect(api.markRead).toHaveBeenCalledWith('notification-1');
    expect(state.items.value[0].readAt).not.toBeNull();
    expect(state.unreadCount.value).toBe(0);
    dispose();
  });

  it('preserves the last successful view when refresh fails', async () => {
    const { state, dispose } = mount();
    await state.open();
    api.list.mockRejectedValueOnce(new Error('offline'));

    await state.refresh();

    expect(state.items.value).toHaveLength(1);
    expect(state.failure.value).not.toBeNull();
    dispose();
  });

  it('marks all unread items without another list round trip', async () => {
    const { state, dispose } = mount();
    await state.open();

    await state.markAllRead();

    expect(api.markAllRead).toHaveBeenCalledTimes(1);
    expect(state.unreadCount.value).toBe(0);
    expect(state.items.value[0].readAt).not.toBeNull();
    dispose();
  });
});

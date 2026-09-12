import { computed, readonly, shallowRef } from 'vue';
import type { ParentNotification } from '@clinic/contracts';
import { createSequence, usePolling } from '@clinic/client-ui';
import { notificationsApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';

export const PARENT_NOTIFICATIONS_POLL_MS = 15_000;

export function useParentNotifications() {
  const items = shallowRef<ParentNotification[]>([]);
  const unreadCount = shallowRef(0);
  const loading = shallowRef(true);
  const working = shallowRef(false);
  const failure = shallowRef<string | null>(null);
  const sequence = createSequence();

  const hasUnread = computed(() => unreadCount.value > 0);

  async function read(): Promise<void> {
    const ticket = sequence.next();
    const view = await notificationsApi.list();
    if (!sequence.accept(ticket)) return;
    items.value = view.items;
    unreadCount.value = view.unreadCount;
  }

  async function refresh(): Promise<void> {
    failure.value = null;
    try {
      await read();
    } catch (error) {
      failure.value = apiMessage(error);
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
    intervalMs: PARENT_NOTIFICATIONS_POLL_MS,
    onResume: () => void refresh(),
  });

  async function open(): Promise<void> {
    loading.value = items.value.length === 0;
    await refresh();
    loading.value = false;
    polling.start();
  }

  function close(): void {
    polling.stop();
  }

  async function markRead(notification: ParentNotification): Promise<void> {
    if (notification.readAt !== null || working.value) return;
    working.value = true;
    failure.value = null;
    try {
      const updated = await notificationsApi.markRead(notification.id);
      items.value = items.value.map((item) =>
        item.id === updated.id ? updated : item,
      );
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      working.value = false;
    }
  }

  async function markAllRead(): Promise<void> {
    if (!hasUnread.value || working.value) return;
    working.value = true;
    failure.value = null;
    try {
      await notificationsApi.markAllRead();
      const readAt = new Date().toISOString();
      items.value = items.value.map((item) => ({
        ...item,
        readAt: item.readAt ?? readAt,
      }));
      unreadCount.value = 0;
    } catch (error) {
      failure.value = apiMessage(error);
    } finally {
      working.value = false;
    }
  }

  return {
    items: readonly(items),
    unreadCount: readonly(unreadCount),
    hasUnread,
    loading: readonly(loading),
    working: readonly(working),
    failure: readonly(failure),
    polling,
    open,
    close,
    refresh,
    markRead,
    markAllRead,
  };
}

export type ParentNotificationsState = ReturnType<
  typeof useParentNotifications
>;

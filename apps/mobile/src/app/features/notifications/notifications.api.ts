import type { ApiClient } from '@clinic/api-client';
import type {
  ParentNotification,
  ParentNotificationsView,
} from '@clinic/contracts';

export function createParentNotificationsApi(client: ApiClient) {
  return {
    list: (): Promise<ParentNotificationsView> =>
      client.get<ParentNotificationsView>('me/notifications'),
    markRead: (notificationId: string): Promise<ParentNotification> =>
      client.post<ParentNotification>(
        `me/notifications/${notificationId}/read`,
      ),
    markAllRead: (): Promise<void> =>
      client.post<void>('me/notifications/read-all'),
  };
}

export type ParentNotificationsApi = ReturnType<
  typeof createParentNotificationsApi
>;

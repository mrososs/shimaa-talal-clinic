export const NotificationsErrorCode = {
  NotFound: 'notification_not_found',
} as const;

export type NotificationsErrorCode =
  (typeof NotificationsErrorCode)[keyof typeof NotificationsErrorCode];

export class NotificationsError extends Error {
  constructor(
    readonly code: NotificationsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NotificationsError';
  }
}

export type ParentNotificationKind =
  | 'appointment_confirmed'
  | 'appointment_cancelled'
  | 'appointment_no_show'
  | 'appointment_completed'
  | 'queue_called'
  | 'queue_missed'
  | 'queue_requeued'
  | 'payment_approved'
  | 'payment_rejected'
  | 'payment_refunded'
  | 'message_reply'
  | 'urgent_accepted'
  | 'urgent_rejected';

export interface ParentNotification {
  id: string;
  kind: ParentNotificationKind;
  title: string;
  body: string;
  deepLink: string;
  readAt: string | null;
  createdAt: string;
}

export interface ParentNotificationsView {
  items: ParentNotification[];
  unreadCount: number;
}

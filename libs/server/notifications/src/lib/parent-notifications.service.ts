import { Injectable } from '@nestjs/common';
import type {
  ParentNotification,
  ParentNotificationKind,
  ParentNotificationsView,
} from '@clinic/contracts';
import {
  DatabaseService,
  type QueryResultRow,
} from '@clinic/server-core';
import {
  NotificationsError,
  NotificationsErrorCode,
} from './notifications.errors';

interface NotificationRow extends QueryResultRow {
  id: string;
  kind: ParentNotificationKind;
  title: string;
  body: string;
  deep_link: string;
  read_at: Date | null;
  created_at: Date;
}

@Injectable()
export class ParentNotificationsService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    clinicId: string,
    guardianId: string,
  ): Promise<ParentNotificationsView> {
    const [items, unread] = await Promise.all([
      this.database.query<NotificationRow>(
        `select id, kind, title, body, deep_link, read_at, created_at
           from clinic.guardian_notifications
          where clinic_id = $1 and guardian_id = $2
          order by created_at desc, id desc
          limit 100`,
        [clinicId, guardianId],
      ),
      this.database.query<{ count: string }>(
        `select count(*)::text as count
           from clinic.guardian_notifications
          where clinic_id = $1 and guardian_id = $2 and read_at is null`,
        [clinicId, guardianId],
      ),
    ]);

    return {
      items: items.rows.map(toNotification),
      unreadCount: Number(unread.rows[0]?.count ?? 0),
    };
  }

  async markRead(
    clinicId: string,
    guardianId: string,
    notificationId: string,
  ): Promise<ParentNotification> {
    const updated = await this.database.query<NotificationRow>(
      `update clinic.guardian_notifications
          set read_at = coalesce(read_at, now())
        where id = $1 and clinic_id = $2 and guardian_id = $3
      returning id, kind, title, body, deep_link, read_at, created_at`,
      [notificationId, clinicId, guardianId],
    );
    const row = updated.rows[0];
    if (!row) {
      throw new NotificationsError(
        NotificationsErrorCode.NotFound,
        'Notification not found.',
      );
    }
    return toNotification(row);
  }

  async markAllRead(clinicId: string, guardianId: string): Promise<void> {
    await this.database.query(
      `update clinic.guardian_notifications
          set read_at = now()
        where clinic_id = $1 and guardian_id = $2 and read_at is null`,
      [clinicId, guardianId],
    );
  }
}

function toNotification(row: NotificationRow): ParentNotification {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

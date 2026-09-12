import { randomUUID } from 'node:crypto';
import { describeWithDatabase } from './messages.fixture';
import {
  NotificationsErrorCode,
} from './notifications.errors';
import { ParentNotificationsService } from './parent-notifications.service';

describeWithDatabase('parent notifications', (fx) => {
  const service = () => new ParentNotificationsService(fx.db.database);

  afterEach(async () => {
    await fx.db.database.query(
      `delete from clinic.guardian_notifications where clinic_id = $1`,
      [fx.clinicId],
    );
  });

  async function insert(title: string): Promise<string> {
    const result = await fx.db.database.query<{ id: string }>(
      `insert into clinic.guardian_notifications
         (clinic_id, guardian_id, kind, title, body, deep_link,
          source_type, source_event_id)
       values ($1, $2, 'queue_called', $3, 'اختبار آمن', '/tabs/queue',
               'queue_event', $4)
       returning id`,
      [fx.clinicId, fx.guardianId, title, randomUUID()],
    );
    return result.rows[0].id;
  }

  it('lists only the guardian notifications and counts unread rows', async () => {
    await insert('الأولى');
    await insert('الثانية');

    const view = await service().list(fx.clinicId, fx.guardianId);

    expect(view.unreadCount).toBe(2);
    expect(view.items.map((item) => item.title)).toEqual(['الثانية', 'الأولى']);
    expect(view.items.every((item) => item.deepLink === '/tabs/queue')).toBe(true);
  });

  it('marks one notification idempotently', async () => {
    const id = await insert('اقرئيها');

    const first = await service().markRead(fx.clinicId, fx.guardianId, id);
    const second = await service().markRead(fx.clinicId, fx.guardianId, id);

    expect(first.readAt).not.toBeNull();
    expect(second.readAt).toBe(first.readAt);
    expect((await service().list(fx.clinicId, fx.guardianId)).unreadCount).toBe(0);
  });

  it('does not reveal a notification through another clinic scope', async () => {
    const id = await insert('خاصة');

    await expect(
      service().markRead(fx.otherClinicId, fx.guardianId, id),
    ).rejects.toMatchObject({ code: NotificationsErrorCode.NotFound });
  });

  it('marks every owned notification without touching another guardian', async () => {
    await insert('أ');
    await insert('ب');

    await service().markAllRead(fx.clinicId, fx.guardianId);

    expect((await service().list(fx.clinicId, fx.guardianId)).unreadCount).toBe(0);
  });
});

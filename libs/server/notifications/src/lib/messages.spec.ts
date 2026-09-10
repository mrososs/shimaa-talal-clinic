import { MessagesService } from './messages.service';
import { MessagesErrorCode } from './messages.errors';
import {
  clearThreads,
  describeWithDatabase,
  insertGuardianMessage,
} from './messages.fixture';

/**
 * The staff inbox, against a real server.
 *
 * Most of what this screen promises is a database guarantee rather than a
 * TypeScript one: unread is a join against a per-member read marker, "send it
 * twice and it appears once" is a unique index, and "already decided" is a
 * `where` clause that either matched a row or did not. Asserting any of that
 * against a mocked executor would prove only that the mock behaves as written.
 */
describeWithDatabase('messages', (fx) => {
  const service = () => new MessagesService(fx.db.database);

  /** A thread from the desk, which is the only way one is created today. */
  const openThread = (subject = 'سؤال عن الجرعة') =>
    service().createThread(fx.clinicId, fx.receptionMemberId, {
      guardianId: fx.guardianId,
      childId: fx.childId,
      contactName: 'أم لين',
      childName: 'لين',
      subject,
      initialMessage: 'أهلاً بكم، كيف نقدر نساعد؟',
    });

  const eventsFor = async (threadId: string): Promise<string[]> => {
    const result = await fx.db.database.query<{ event_type: string }>(
      `select event_type from clinic.message_events
        where thread_id = $1 order by created_at, id`,
      [threadId],
    );
    return result.rows.map((row) => row.event_type);
  };

  const outboxKinds = async (threadId: string): Promise<string[]> => {
    const result = await fx.db.database.query<{ kind: string }>(
      `select kind from clinic.notification_outbox
        where aggregate_id = $1 order by created_at, id`,
      [threadId],
    );
    return result.rows.map((row) => row.kind);
  };

  afterEach(async () => {
    await clearThreads(fx.db.database, [fx.clinicId, fx.otherClinicId]);
  });

  describe('starting a conversation', () => {
    it('opens a thread carrying its first message', async () => {
      const thread = await openThread();

      expect(thread).toMatchObject({
        status: 'open',
        priority: 'normal',
        subject: 'سؤال عن الجرعة',
        unreadCount: 0,
      });
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0]).toMatchObject({
        senderType: 'staff',
        body: 'أهلاً بكم، كيف نقدر نساعد؟',
      });
      expect(await eventsFor(thread.id)).toEqual(['created']);
    });

    it('refuses a guardian who does not have that child', async () => {
      const stranger = await fx.db.database.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name)
         values ($1, 'Someone Else') returning id`,
        [fx.clinicId],
      );

      await expect(
        service().createThread(fx.clinicId, fx.receptionMemberId, {
          guardianId: fx.guardianId,
          childId: stranger.rows[0].id,
          contactName: 'أم لين',
          childName: 'ليس ابنها',
          subject: 'محاولة',
          initialMessage: 'لا',
        }),
      ).rejects.toMatchObject({ code: MessagesErrorCode.InvalidParticipant });

      await fx.db.database.query(`delete from clinic.children where id = $1`, [
        stranger.rows[0].id,
      ]);
    });
  });

  describe('guardian conversations', () => {
    const startAsParent = (requestId: string) =>
      service().createParentThread(fx.clinicId, fx.guardianId, {
        childId: fx.childId,
        subject: 'استفسار من التطبيق',
        initialMessage: 'الحرارة مرتفعة منذ الصباح',
        clientRequestId: requestId,
      });

    it('creates one owned thread under a real retry race', async () => {
      const requestId = '7a413745-9381-4ca5-bbdd-a8b8ff7f1084';
      const [first, second] = await Promise.all([
        startAsParent(requestId),
        startAsParent(requestId),
      ]);

      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        contactName: 'Messages Guardian',
        childName: 'Messages Child',
        unreadCount: 0,
      });
      expect(first.messages).toHaveLength(1);
      expect(first.messages[0]).toMatchObject({
        senderType: 'guardian',
        body: 'الحرارة مرتفعة منذ الصباح',
      });

      const actor = await fx.db.database.query<{
        actor_guardian_id: string | null;
        actor_member_id: string | null;
      }>(
        `select actor_guardian_id, actor_member_id
           from clinic.message_events where thread_id = $1`,
        [first.id],
      );
      expect(actor.rows).toEqual([
        { actor_guardian_id: fx.guardianId, actor_member_id: null },
      ]);
    });

    it('shows staff replies as unread until the guardian reads them', async () => {
      const thread = await startAsParent(
        '2fb5730a-3d0e-42ce-9dce-02e417c56792',
      );
      await service().reply(
        fx.clinicId,
        fx.doctorMemberId,
        thread.id,
        'تابعي الحرارة كل أربع ساعات',
        '32e3fc2a-11c1-464b-bd73-30a763c54579',
      );

      const unread = await service().parentInbox(
        fx.clinicId,
        fx.guardianId,
      );
      expect(unread.totalUnread).toBe(1);

      await service().parentMarkRead(
        fx.clinicId,
        fx.guardianId,
        thread.id,
      );
      const read = await service().parentInbox(fx.clinicId, fx.guardianId);
      expect(read.totalUnread).toBe(0);
    });

    it('keeps another guardian outside the thread', async () => {
      const thread = await startAsParent(
        '0636a7cb-9d16-4e96-8a42-361c46f72c35',
      );
      const stranger = await fx.db.database.query<{ id: string }>(
        `insert into clinic.guardians (clinic_id, full_name, phone_e164)
         values ($1, 'Other Guardian', $2) returning id`,
        [fx.clinicId, `+2012${String(Date.now()).slice(-7)}`],
      );

      await expect(
        service().parentDetail(
          fx.clinicId,
          stranger.rows[0].id,
          thread.id,
        ),
      ).rejects.toMatchObject({ code: MessagesErrorCode.ThreadNotFound });

      await fx.db.database.query(`delete from clinic.guardians where id = $1`, [
        stranger.rows[0].id,
      ]);
    });

    it('replies idempotently and makes the reply unread for staff', async () => {
      const thread = await startAsParent(
        'b6c1c05b-cb7b-4ddb-b374-14312762561c',
      );
      const replyId = '1c3221bf-b83b-4097-a923-3235ff824fae';

      const [first, second] = await Promise.all([
        service().parentReply(
          fx.clinicId,
          fx.guardianId,
          thread.id,
          'هل أحتاج للحضور؟',
          replyId,
        ),
        service().parentReply(
          fx.clinicId,
          fx.guardianId,
          thread.id,
          'هل أحتاج للحضور؟',
          replyId,
        ),
      ]);

      expect(second.id).toBe(first.id);
      const staff = await service().inbox(
        fx.clinicId,
        fx.receptionMemberId,
      );
      expect(staff.threads[0].unreadCount).toBe(2);
    });

    it('raises one urgent case with the guardian as its actor', async () => {
      const thread = await startAsParent(
        'de92d64f-d89d-4582-8ad9-393e2ca8c7de',
      );
      const first = await service().parentRaiseUrgent(
        fx.clinicId,
        fx.guardianId,
        thread.id,
        'صعوبة في التنفس',
      );
      const second = await service().parentRaiseUrgent(
        fx.clinicId,
        fx.guardianId,
        thread.id,
        'لن ينشئ حالة أخرى',
      );

      expect(second.id).toBe(first.id);
      const row = await fx.db.database.query<{
        raised_by_guardian_id: string | null;
        raised_by_member_id: string | null;
      }>(
        `select raised_by_guardian_id, raised_by_member_id
           from clinic.urgent_cases where id = $1`,
        [first.id],
      );
      expect(row.rows[0]).toEqual({
        raised_by_guardian_id: fx.guardianId,
        raised_by_member_id: null,
      });
    });
  });

  describe('unread', () => {
    it('counts what the family said, not what the desk replied', async () => {
      const thread = await openThread();
      await insertGuardianMessage(fx.db.database, {
        clinicId: fx.clinicId,
        threadId: thread.id,
        guardianId: fx.guardianId,
        body: 'الحرارة ٣٨',
      });

      const inbox = await service().inbox(fx.clinicId, fx.receptionMemberId);

      // The desk's own opening message is not unread for the desk.
      expect(inbox.totalUnread).toBe(1);
      expect(inbox.threads[0].unreadCount).toBe(1);
    });

    it('is per member, so reading at the desk does not clear it for the doctor', async () => {
      const thread = await openThread();
      await insertGuardianMessage(fx.db.database, {
        clinicId: fx.clinicId,
        threadId: thread.id,
        guardianId: fx.guardianId,
        body: 'الحرارة ٣٨',
      });

      await service().markRead(fx.clinicId, fx.receptionMemberId, thread.id);

      const desk = await service().inbox(fx.clinicId, fx.receptionMemberId);
      const doctor = await service().inbox(fx.clinicId, fx.doctorMemberId);
      expect(desk.totalUnread).toBe(0);
      expect(doctor.totalUnread).toBe(1);
    });

    it('comes back when the family writes again after a read', async () => {
      const thread = await openThread();
      await insertGuardianMessage(fx.db.database, {
        clinicId: fx.clinicId,
        threadId: thread.id,
        guardianId: fx.guardianId,
        body: 'الحرارة ٣٨',
      });
      await service().markRead(fx.clinicId, fx.receptionMemberId, thread.id);
      await insertGuardianMessage(fx.db.database, {
        clinicId: fx.clinicId,
        threadId: thread.id,
        guardianId: fx.guardianId,
        body: 'ارتفعت إلى ٣٩',
      });

      const inbox = await service().inbox(fx.clinicId, fx.receptionMemberId);
      expect(inbox.threads[0].unreadCount).toBe(1);
    });
  });

  describe('replying', () => {
    it('appears once however many times the same reply is sent', async () => {
      const thread = await openThread();
      const requestId = '5f1d4c7e-2b3a-4c6d-8e9f-0a1b2c3d4e5f';

      const [first, second] = await Promise.all([
        service().reply(fx.clinicId, fx.doctorMemberId, thread.id, 'تمام', requestId),
        service().reply(fx.clinicId, fx.doctorMemberId, thread.id, 'تمام', requestId),
      ]);

      // A double tap, or a retry over a flaky link. The unique index decides,
      // and both callers are told about the one message that exists.
      expect(first.id).toBe(second.id);
      const detail = await service().detail(fx.clinicId, fx.doctorMemberId, thread.id);
      expect(detail.messages.filter((m) => m.body === 'تمام')).toHaveLength(1);
    });

    it('records the reply and queues one notification', async () => {
      const thread = await openThread();

      await service().reply(
        fx.clinicId,
        fx.doctorMemberId,
        thread.id,
        'تابعي الحرارة',
        '11111111-2222-4333-8444-555555555555',
      );

      expect(await eventsFor(thread.id)).toEqual(['created', 'replied']);
      expect(await outboxKinds(thread.id)).toEqual(['staff_reply']);
    });

    it('refuses a reply to a closed thread', async () => {
      const thread = await openThread();
      await service().setClosed(fx.clinicId, fx.doctorMemberId, thread.id, true);

      await expect(
        service().reply(
          fx.clinicId,
          fx.doctorMemberId,
          thread.id,
          'متأخر',
          '22222222-3333-4444-8555-666666666666',
        ),
      ).rejects.toMatchObject({ code: MessagesErrorCode.ThreadClosed });
    });
  });

  describe('closing and reopening', () => {
    it('closes, reopens, and records each turn once', async () => {
      const thread = await openThread();

      const closed = await service().setClosed(fx.clinicId, fx.doctorMemberId, thread.id, true);
      expect(closed.status).toBe('closed');

      const reopened = await service().setClosed(fx.clinicId, fx.doctorMemberId, thread.id, false);
      expect(reopened.status).toBe('open');

      expect(await eventsFor(thread.id)).toEqual(['created', 'closed', 'reopened']);
    });

    it('closing an already closed thread changes nothing and records nothing', async () => {
      const thread = await openThread();
      await service().setClosed(fx.clinicId, fx.doctorMemberId, thread.id, true);

      const again = await service().setClosed(fx.clinicId, fx.doctorMemberId, thread.id, true);

      // The caller's intent is already achieved, so it is told the current
      // state rather than refused.
      expect(again.status).toBe('closed');
      expect(await eventsFor(thread.id)).toEqual(['created', 'closed']);
    });
  });

  describe('assignment', () => {
    it('hands the thread to the active doctor', async () => {
      const thread = await openThread();

      const assigned = await service().assignToDoctor(
        fx.clinicId,
        fx.receptionMemberId,
        thread.id,
      );

      expect(assigned.assignedMemberId).toBe(fx.doctorMemberId);
      expect(assigned.assignedMemberName).toBe('د. شيماء');
      expect(await eventsFor(thread.id)).toEqual(['created', 'assigned']);
    });

    it('finds it under the assigned filter, and only then', async () => {
      const thread = await openThread();
      await service().assignToDoctor(fx.clinicId, fx.receptionMemberId, thread.id);

      const forDoctor = await service().inbox(fx.clinicId, fx.doctorMemberId, 'assigned');
      const forDesk = await service().inbox(fx.clinicId, fx.receptionMemberId, 'assigned');

      expect(forDoctor.threads.map((t) => t.id)).toEqual([thread.id]);
      expect(forDesk.threads).toHaveLength(0);
    });
  });

  describe('urgent triage', () => {
    it('raises a case and marks the thread urgent', async () => {
      const thread = await openThread();

      const urgent = await service().raiseUrgent(
        fx.clinicId,
        fx.receptionMemberId,
        thread.id,
        'حرارة ٣٩ ولا تستجيب للخافض',
      );

      expect(urgent).toMatchObject({ status: 'pending', resolvedAt: null });
      const detail = await service().detail(fx.clinicId, fx.doctorMemberId, thread.id);
      expect(detail.priority).toBe('urgent');
      expect(detail.urgentCase?.id).toBe(urgent.id);
      expect(await outboxKinds(thread.id)).toEqual(['urgent_case_raised']);
    });

    it('raising twice yields the one case, not a second', async () => {
      const thread = await openThread();
      const first = await service().raiseUrgent(fx.clinicId, fx.receptionMemberId, thread.id, 'أولى');

      const second = await service().raiseUrgent(fx.clinicId, fx.receptionMemberId, thread.id, 'ثانية');

      expect(second.id).toBe(first.id);
      expect(second.triageNote).toBe('أولى');
    });

    it('rejects a case once, and refuses to decide it again', async () => {
      const thread = await openThread();
      const urgent = await service().raiseUrgent(fx.clinicId, fx.receptionMemberId, thread.id, 'حرارة');

      const rejected = await service().rejectUrgent(
        fx.clinicId,
        fx.doctorMemberId,
        urgent.id,
        'تكفي متابعة منزلية',
      );
      expect(rejected).toMatchObject({
        status: 'rejected',
        decisionNote: 'تكفي متابعة منزلية',
      });
      expect(rejected.resolvedAt).not.toBeNull();

      await expect(
        service().rejectUrgent(fx.clinicId, fx.doctorMemberId, urgent.id, null),
      ).rejects.toMatchObject({
        code: MessagesErrorCode.UrgentCaseAlreadyDecided,
      });
    });

    it('lets exactly one of two simultaneous decisions through', async () => {
      const thread = await openThread();
      const urgent = await service().raiseUrgent(fx.clinicId, fx.receptionMemberId, thread.id, 'حرارة');

      const outcomes = await Promise.allSettled([
        service().rejectUrgent(fx.clinicId, fx.doctorMemberId, urgent.id, 'أ'),
        service().rejectUrgent(fx.clinicId, fx.doctorMemberId, urgent.id, 'ب'),
      ]);

      // Two doctors on two screens. The `status = 'pending'` predicate is the
      // arbiter, not a read-then-write in the service.
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
    });

    it('refuses to lock a case that belongs to another clinic', async () => {
      const thread = await openThread();
      const urgent = await service().raiseUrgent(fx.clinicId, fx.receptionMemberId, thread.id, 'حرارة');

      await expect(
        fx.db.database.transaction((tx) =>
          service().lockUrgentCase(fx.otherClinicId, urgent.id, tx),
        ),
      ).rejects.toMatchObject({ code: MessagesErrorCode.UrgentCaseNotFound });
    });
  });

  describe('filters and tenancy', () => {
    it('puts urgent and open threads at the top', async () => {
      const quiet = await openThread('سؤال عادي');
      const loud = await openThread('حالة عاجلة');
      await service().raiseUrgent(fx.clinicId, fx.receptionMemberId, loud.id, 'حرارة');

      const inbox = await service().inbox(fx.clinicId, fx.receptionMemberId);

      expect(inbox.threads[0].id).toBe(loud.id);
      expect(inbox.threads.map((t) => t.id)).toContain(quiet.id);
    });

    it('narrows to unread, urgent and open', async () => {
      const plain = await openThread('عادي');
      const urgent = await openThread('عاجل');
      await service().raiseUrgent(fx.clinicId, fx.receptionMemberId, urgent.id, 'حرارة');
      await insertGuardianMessage(fx.db.database, {
        clinicId: fx.clinicId,
        threadId: plain.id,
        guardianId: fx.guardianId,
        body: 'سؤال',
      });
      await service().setClosed(fx.clinicId, fx.doctorMemberId, urgent.id, true);

      const service_ = service();
      const [unread, urgentOnly, open] = await Promise.all([
        service_.inbox(fx.clinicId, fx.receptionMemberId, 'unread'),
        service_.inbox(fx.clinicId, fx.receptionMemberId, 'urgent'),
        service_.inbox(fx.clinicId, fx.receptionMemberId, 'open'),
      ]);

      expect(unread.threads.map((t) => t.id)).toEqual([plain.id]);
      expect(urgentOnly.threads.map((t) => t.id)).toEqual([urgent.id]);
      expect(open.threads.map((t) => t.id)).toEqual([plain.id]);
    });

    it('offers the clinic its own active quick replies', async () => {
      const inbox = await service().inbox(fx.clinicId, fx.receptionMemberId);

      expect(inbox.templates.map((t) => t.title)).toEqual([
        'تعليمات الخافض',
        'موعد المتابعة',
      ]);
    });

    it('does not show one clinic a thread belonging to another', async () => {
      const thread = await openThread();

      const foreign = await service().inbox(fx.otherClinicId, fx.otherClinicMemberId);
      expect(foreign.threads).toHaveLength(0);

      await expect(
        service().detail(fx.otherClinicId, fx.otherClinicMemberId, thread.id),
      ).rejects.toMatchObject({ code: MessagesErrorCode.ThreadNotFound });
    });
  });
});

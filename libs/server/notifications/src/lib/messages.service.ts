import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type {
  CreateParentMessageThreadInput,
  CreateMessageThreadInput,
  MessageInbox,
  ParentMessageInbox,
  MessageThreadDetail,
  MessageThreadSummary,
  QuickReplyTemplate,
  ThreadMessage,
  UrgentCaseSummary,
} from '@clinic/contracts';
import { MessagesError, MessagesErrorCode } from './messages.errors';

export type MessageInboxFilter = 'all' | 'open' | 'unread' | 'urgent' | 'assigned';

interface ThreadRow extends QueryResultRow {
  id: string;
  guardian_id: string;
  child_id: string;
  contact_name: string;
  child_name: string;
  subject: string;
  status: 'open' | 'closed';
  priority: 'normal' | 'urgent';
  assigned_member_id: string | null;
  assigned_member_name: string | null;
  last_message_preview: string;
  last_message_at: Date;
  unread_count: string;
  urgent_id: string | null;
  urgent_status: 'pending' | 'accepted' | 'rejected' | null;
  triage_note: string | null;
  decision_note: string | null;
  urgent_created_at: Date | null;
  resolved_at: Date | null;
}

interface MessageRow extends QueryResultRow {
  id: string;
  thread_id: string;
  sender_member_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: Date;
}

interface TemplateRow extends QueryResultRow {
  id: string;
  title: string;
  body: string;
}

interface UrgentRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  thread_id: string;
  child_id: string;
  guardian_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  triage_note: string;
  decision_note: string | null;
  created_at: Date;
  resolved_at: Date | null;
}

const THREAD_SELECT = `
  select t.id, t.guardian_id, t.child_id, t.contact_name, t.child_name,
         t.subject, t.status, t.priority, t.assigned_member_id,
         assignee.display_name as assigned_member_name,
         coalesce(last_message.body, '') as last_message_preview,
         t.last_message_at,
         count(unread.id)::text as unread_count,
         urgent.id as urgent_id, urgent.status as urgent_status,
         urgent.triage_note, urgent.decision_note,
         urgent.created_at as urgent_created_at, urgent.resolved_at
    from clinic.message_threads t
    left join clinic.clinic_members assignee
      on assignee.id = t.assigned_member_id and assignee.clinic_id = t.clinic_id
    left join lateral (
      select m.body from clinic.thread_messages m
       where m.thread_id = t.id order by m.created_at desc, m.id desc limit 1
    ) last_message on true
    left join clinic.message_thread_reads reads
      on reads.thread_id = t.id and reads.member_id = $2
    left join clinic.thread_messages unread
      on unread.thread_id = t.id and unread.sender_guardian_id is not null
     and unread.created_at > coalesce(reads.last_read_at, '-infinity'::timestamptz)
    left join clinic.urgent_cases urgent on urgent.thread_id = t.id
   where t.clinic_id = $1`;

const PARENT_THREAD_SELECT = `
  select t.id, t.guardian_id, t.child_id, t.contact_name, t.child_name,
         t.subject, t.status, t.priority, t.assigned_member_id,
         assignee.display_name as assigned_member_name,
         coalesce(last_message.body, '') as last_message_preview,
         t.last_message_at,
         count(unread.id)::text as unread_count,
         urgent.id as urgent_id, urgent.status as urgent_status,
         urgent.triage_note, urgent.decision_note,
         urgent.created_at as urgent_created_at, urgent.resolved_at
    from clinic.message_threads t
    left join clinic.clinic_members assignee
      on assignee.id = t.assigned_member_id and assignee.clinic_id = t.clinic_id
    left join lateral (
      select m.body from clinic.thread_messages m
       where m.thread_id = t.id order by m.created_at desc, m.id desc limit 1
    ) last_message on true
    left join clinic.thread_messages unread
      on unread.thread_id = t.id and unread.sender_member_id is not null
     and unread.created_at > t.guardian_last_read_at
    left join clinic.urgent_cases urgent on urgent.thread_id = t.id
   where t.clinic_id = $1 and t.guardian_id = $2`;

@Injectable()
export class MessagesService {
  constructor(private readonly database: DatabaseService) {}

  async inbox(
    clinicId: string,
    memberId: string,
    filter: MessageInboxFilter = 'all',
  ): Promise<MessageInbox> {
    const condition = filterCondition(filter);
    const [threads, templates] = await Promise.all([
      this.database.query<ThreadRow>(
        `${THREAD_SELECT} ${condition}
         group by t.id, assignee.display_name, last_message.body, urgent.id
         order by (t.status = 'open') desc, (t.priority = 'urgent') desc,
                  t.last_message_at desc limit 200`,
        [clinicId, memberId],
      ),
      this.database.query<TemplateRow>(
        `select id, title, body from clinic.quick_reply_templates
          where clinic_id = $1 and active order by sort_order, title`,
        [clinicId],
      ),
    ]);
    const mapped = threads.rows.map(toThread);
    return {
      threads: mapped,
      templates: templates.rows.map(toTemplate),
      totalUnread: mapped.reduce((total, thread) => total + thread.unreadCount, 0),
    };
  }

  async parentInbox(
    clinicId: string,
    guardianId: string,
  ): Promise<ParentMessageInbox> {
    const result = await this.database.query<ThreadRow>(
      `${PARENT_THREAD_SELECT}
       group by t.id, assignee.display_name, last_message.body, urgent.id
       order by (t.status = 'open') desc, (t.priority = 'urgent') desc,
                t.last_message_at desc limit 200`,
      [clinicId, guardianId],
    );
    const threads = result.rows.map(toThread);
    return {
      threads,
      totalUnread: threads.reduce(
        (total, thread) => total + thread.unreadCount,
        0,
      ),
    };
  }

  async parentDetail(
    clinicId: string,
    guardianId: string,
    threadId: string,
  ): Promise<MessageThreadDetail> {
    const [summary, messages] = await Promise.all([
      this.database.query<ThreadRow>(
        `${PARENT_THREAD_SELECT} and t.id = $3
         group by t.id, assignee.display_name, last_message.body, urgent.id`,
        [clinicId, guardianId, threadId],
      ),
      this.database.query<MessageRow>(
        `select m.id, m.thread_id, m.sender_member_id,
                coalesce(member.display_name, thread.contact_name) as sender_name,
                m.body, m.created_at
           from clinic.thread_messages m
           join clinic.message_threads thread on thread.id = m.thread_id
           left join clinic.clinic_members member on member.id = m.sender_member_id
          where m.clinic_id = $1 and thread.guardian_id = $2
            and m.thread_id = $3
          order by m.created_at, m.id limit 500`,
        [clinicId, guardianId, threadId],
      ),
    ]);
    const row = summary.rows[0];
    if (!row) throw threadNotFound();
    return { ...toThread(row), messages: messages.rows.map(toMessage) };
  }

  async createParentThread(
    clinicId: string,
    guardianId: string,
    input: CreateParentMessageThreadInput,
  ): Promise<MessageThreadDetail> {
    const threadId = await this.database.transaction(async (tx) => {
      const created = await tx.query<{ id: string }>(
        `insert into clinic.message_threads
           (clinic_id, guardian_id, child_id, contact_name, child_name,
            subject, client_request_id)
         select $1, g.id, c.id, g.full_name, c.full_name, $4, $5
           from clinic.guardian_children gc
           join clinic.guardians g
             on g.id = gc.guardian_id and g.clinic_id = $1
           join clinic.children c
             on c.id = gc.child_id and c.clinic_id = $1
          where gc.guardian_id = $2 and gc.child_id = $3
         on conflict (guardian_id, client_request_id)
           where client_request_id is not null
         do nothing
         returning id`,
        [
          clinicId,
          guardianId,
          input.childId,
          input.subject.trim(),
          input.clientRequestId,
        ],
      );

      let id = created.rows[0]?.id;
      if (!id) {
        const existing = await tx.query<{ id: string }>(
          `select id from clinic.message_threads
            where clinic_id = $1 and guardian_id = $2
              and client_request_id = $3`,
          [clinicId, guardianId, input.clientRequestId],
        );
        id = existing.rows[0]?.id;
        if (!id) {
          throw new MessagesError(
            MessagesErrorCode.InvalidParticipant,
            'The selected guardian cannot access this child.',
          );
        }
        return id;
      }

      await tx.query(
        `insert into clinic.thread_messages
           (clinic_id, thread_id, sender_guardian_id, body, client_request_id)
         values ($1, $2, $3, $4, $5)`,
        [
          clinicId,
          id,
          guardianId,
          input.initialMessage.trim(),
          input.clientRequestId,
        ],
      );
      await this.guardianEvent(
        clinicId,
        id,
        guardianId,
        'created',
        {},
        tx,
      );
      await this.outbox(
        clinicId,
        'parent_thread_created',
        id,
        {},
        tx,
      );
      return id;
    });
    return this.parentDetail(clinicId, guardianId, threadId);
  }

  async detail(
    clinicId: string,
    memberId: string,
    threadId: string,
  ): Promise<MessageThreadDetail> {
    const [summary, messages] = await Promise.all([
      this.database.query<ThreadRow>(
        `${THREAD_SELECT} and t.id = $3
         group by t.id, assignee.display_name, last_message.body, urgent.id`,
        [clinicId, memberId, threadId],
      ),
      this.database.query<MessageRow>(
        `select m.id, m.thread_id, m.sender_member_id,
                coalesce(member.display_name, thread.contact_name) as sender_name,
                m.body, m.created_at
           from clinic.thread_messages m
           join clinic.message_threads thread on thread.id = m.thread_id
           left join clinic.clinic_members member on member.id = m.sender_member_id
          where m.clinic_id = $1 and m.thread_id = $2
          order by m.created_at, m.id limit 500`,
        [clinicId, threadId],
      ),
    ]);
    const row = summary.rows[0];
    if (!row) throw threadNotFound();
    return { ...toThread(row), messages: messages.rows.map(toMessage) };
  }

  async createThread(
    clinicId: string,
    memberId: string,
    input: CreateMessageThreadInput,
  ): Promise<MessageThreadDetail> {
    const threadId = await this.database.transaction(async (tx) => {
      const created = await tx.query<{ id: string }>(
        `insert into clinic.message_threads
           (clinic_id, guardian_id, child_id, contact_name, child_name,
            subject, created_by_member_id)
         select $1, $2, $3, $4, $5, $6, $7
           from clinic.guardian_children gc
           join clinic.guardians g on g.id = gc.guardian_id and g.clinic_id = $1
           join clinic.children c on c.id = gc.child_id and c.clinic_id = $1
          where gc.guardian_id = $2 and gc.child_id = $3
         returning id`,
        [
          clinicId,
          input.guardianId,
          input.childId,
          input.contactName.trim(),
          input.childName.trim(),
          input.subject.trim(),
          memberId,
        ],
      );
      const id = created.rows[0]?.id;
      if (!id) {
        throw new MessagesError(
          MessagesErrorCode.InvalidParticipant,
          'The selected guardian cannot access this child.',
        );
      }
      await tx.query(
        `insert into clinic.thread_messages
           (clinic_id, thread_id, sender_member_id, body)
         values ($1, $2, $3, $4)`,
        [clinicId, id, memberId, input.initialMessage.trim()],
      );
      await this.event(clinicId, id, memberId, 'created', {}, tx);
      return id;
    });
    return this.detail(clinicId, memberId, threadId);
  }

  async reply(
    clinicId: string,
    memberId: string,
    threadId: string,
    body: string,
    clientRequestId: string,
  ): Promise<ThreadMessage> {
    const id = await this.database.transaction(async (tx) => {
      const thread = await this.lockThread(clinicId, threadId, tx);
      if (thread.status === 'closed') {
        throw new MessagesError(MessagesErrorCode.ThreadClosed, 'This thread is closed.');
      }
      const inserted = await tx.query<{ id: string }>(
        `insert into clinic.thread_messages
           (clinic_id, thread_id, sender_member_id, body, client_request_id)
         values ($1, $2, $3, $4, $5)
         on conflict (thread_id, client_request_id) do nothing returning id`,
        [clinicId, threadId, memberId, body.trim(), clientRequestId],
      );
      const messageId = inserted.rows[0]?.id;
      if (messageId) {
        await tx.query(
          `update clinic.message_threads set last_message_at = now() where id = $1`,
          [threadId],
        );
        await this.event(clinicId, threadId, memberId, 'replied', {}, tx);
        await this.outbox(clinicId, 'staff_reply', threadId, { messageId }, tx);
        return messageId;
      }
      const existing = await tx.query<{ id: string }>(
        `select id from clinic.thread_messages
          where thread_id = $1 and client_request_id = $2`,
        [threadId, clientRequestId],
      );
      return existing.rows[0].id;
    });
    const result = await this.database.query<MessageRow>(
      `select m.id, m.thread_id, m.sender_member_id, member.display_name as sender_name,
              m.body, m.created_at
         from clinic.thread_messages m
         left join clinic.clinic_members member on member.id = m.sender_member_id
        where m.clinic_id = $1 and m.id = $2`,
      [clinicId, id],
    );
    return toMessage(result.rows[0]);
  }

  async parentReply(
    clinicId: string,
    guardianId: string,
    threadId: string,
    body: string,
    clientRequestId: string,
  ): Promise<ThreadMessage> {
    const id = await this.database.transaction(async (tx) => {
      const thread = await this.lockGuardianThread(
        clinicId,
        guardianId,
        threadId,
        tx,
      );
      if (thread.status === 'closed') {
        throw new MessagesError(
          MessagesErrorCode.ThreadClosed,
          'This thread is closed.',
        );
      }
      const inserted = await tx.query<{ id: string }>(
        `insert into clinic.thread_messages
           (clinic_id, thread_id, sender_guardian_id, body, client_request_id)
         values ($1, $2, $3, $4, $5)
         on conflict (thread_id, client_request_id) do nothing returning id`,
        [clinicId, threadId, guardianId, body.trim(), clientRequestId],
      );
      const messageId = inserted.rows[0]?.id;
      if (messageId) {
        await tx.query(
          `update clinic.message_threads
              set last_message_at = now(), guardian_last_read_at = now()
            where id = $1`,
          [threadId],
        );
        await this.guardianEvent(
          clinicId,
          threadId,
          guardianId,
          'replied',
          {},
          tx,
        );
        await this.outbox(
          clinicId,
          'guardian_reply',
          threadId,
          { messageId },
          tx,
        );
        return messageId;
      }
      const existing = await tx.query<{ id: string }>(
        `select id from clinic.thread_messages
          where thread_id = $1 and client_request_id = $2`,
        [threadId, clientRequestId],
      );
      return existing.rows[0].id;
    });
    const result = await this.database.query<MessageRow>(
      `select m.id, m.thread_id, m.sender_member_id,
              coalesce(member.display_name, thread.contact_name) as sender_name,
              m.body, m.created_at
         from clinic.thread_messages m
         join clinic.message_threads thread on thread.id = m.thread_id
         left join clinic.clinic_members member on member.id = m.sender_member_id
        where m.clinic_id = $1 and thread.guardian_id = $2 and m.id = $3`,
      [clinicId, guardianId, id],
    );
    const row = result.rows[0];
    if (!row) throw threadNotFound();
    return toMessage(row);
  }

  async parentMarkRead(
    clinicId: string,
    guardianId: string,
    threadId: string,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await this.lockGuardianThread(clinicId, guardianId, threadId, tx);
      await tx.query(
        `update clinic.message_threads
            set guardian_last_read_at = now()
          where id = $1`,
        [threadId],
      );
      await this.guardianEvent(
        clinicId,
        threadId,
        guardianId,
        'read',
        {},
        tx,
      );
    });
  }

  async markRead(clinicId: string, memberId: string, threadId: string): Promise<void> {
    await this.requireThread(clinicId, threadId);
    await this.database.transaction(async (tx) => {
      await tx.query(
        `insert into clinic.message_thread_reads (clinic_id, thread_id, member_id)
         values ($1, $2, $3)
         on conflict (thread_id, member_id) do update set last_read_at = now()`,
        [clinicId, threadId, memberId],
      );
      await this.event(clinicId, threadId, memberId, 'read', {}, tx);
    });
  }

  assignToDoctor(clinicId: string, memberId: string, threadId: string): Promise<MessageThreadSummary> {
    return this.database.transaction(async (tx) => {
      await this.lockThread(clinicId, threadId, tx);
      const doctor = await tx.query<{ id: string }>(
        `select id from clinic.clinic_members
          where clinic_id = $1 and role = 'doctor' and status = 'active'
          order by created_at limit 1`,
        [clinicId],
      );
      const doctorId = doctor.rows[0]?.id;
      if (!doctorId) {
        throw new MessagesError(
          MessagesErrorCode.NoDoctorAvailable,
          'No active doctor is available.',
        );
      }
      await tx.query(`update clinic.message_threads set assigned_member_id = $2 where id = $1`, [threadId, doctorId]);
      await this.event(clinicId, threadId, memberId, 'assigned', { assignedMemberId: doctorId }, tx);
      return this.summaryInTx(clinicId, memberId, threadId, tx);
    });
  }

  setClosed(
    clinicId: string,
    memberId: string,
    threadId: string,
    closed: boolean,
  ): Promise<MessageThreadSummary> {
    return this.database.transaction(async (tx) => {
      const thread = await this.lockThread(clinicId, threadId, tx);
      const target = closed ? 'closed' : 'open';
      if (thread.status !== target) {
        await tx.query(
          closed
            ? `update clinic.message_threads set status = 'closed', closed_at = now(), closed_by_member_id = $2 where id = $1`
            : `update clinic.message_threads set status = 'open', closed_at = null, closed_by_member_id = null where id = $1`,
          closed ? [threadId, memberId] : [threadId],
        );
        await this.event(clinicId, threadId, memberId, closed ? 'closed' : 'reopened', {}, tx);
      }
      return this.summaryInTx(clinicId, memberId, threadId, tx);
    });
  }

  raiseUrgent(
    clinicId: string,
    memberId: string,
    threadId: string,
    triageNote: string,
  ): Promise<UrgentCaseSummary> {
    return this.database.transaction(async (tx) => {
      const thread = await this.lockThread(clinicId, threadId, tx);
      const existing = await tx.query<UrgentRow>(
        `select * from clinic.urgent_cases where clinic_id = $1 and thread_id = $2`,
        [clinicId, threadId],
      );
      if (existing.rows[0]) return toUrgent(existing.rows[0]);
      const created = await tx.query<UrgentRow>(
        `insert into clinic.urgent_cases
           (clinic_id, thread_id, child_id, guardian_id, triage_note, raised_by_member_id)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [clinicId, threadId, thread.child_id, thread.guardian_id, triageNote.trim(), memberId],
      );
      await tx.query(`update clinic.message_threads set priority = 'urgent' where id = $1`, [threadId]);
      await this.event(clinicId, threadId, memberId, 'urgent_raised', {}, tx);
      await this.outbox(clinicId, 'urgent_case_raised', threadId, { urgentCaseId: created.rows[0].id }, tx);
      return toUrgent(created.rows[0]);
    });
  }

  parentRaiseUrgent(
    clinicId: string,
    guardianId: string,
    threadId: string,
    triageNote: string,
  ): Promise<UrgentCaseSummary> {
    return this.database.transaction(async (tx) => {
      const thread = await this.lockGuardianThread(
        clinicId,
        guardianId,
        threadId,
        tx,
      );
      const existing = await tx.query<UrgentRow>(
        `select * from clinic.urgent_cases
          where clinic_id = $1 and thread_id = $2`,
        [clinicId, threadId],
      );
      if (existing.rows[0]) return toUrgent(existing.rows[0]);
      const created = await tx.query<UrgentRow>(
        `insert into clinic.urgent_cases
           (clinic_id, thread_id, child_id, guardian_id, triage_note,
            raised_by_guardian_id)
         values ($1, $2, $3, $4, $5, $4) returning *`,
        [
          clinicId,
          threadId,
          thread.child_id,
          guardianId,
          triageNote.trim(),
        ],
      );
      await tx.query(
        `update clinic.message_threads set priority = 'urgent' where id = $1`,
        [threadId],
      );
      await this.guardianEvent(
        clinicId,
        threadId,
        guardianId,
        'urgent_raised',
        {},
        tx,
      );
      await this.outbox(
        clinicId,
        'urgent_case_raised',
        threadId,
        { urgentCaseId: created.rows[0].id },
        tx,
      );
      return toUrgent(created.rows[0]);
    });
  }

  rejectUrgent(
    clinicId: string,
    memberId: string,
    urgentCaseId: string,
    note: string | null,
  ): Promise<UrgentCaseSummary> {
    return this.database.transaction(async (tx) => {
      const result = await tx.query<UrgentRow>(
        `update clinic.urgent_cases
            set status = 'rejected', decided_by_member_id = $3,
                decision_note = $4, resolved_at = now()
          where id = $1 and clinic_id = $2 and status = 'pending'
          returning *`,
        [urgentCaseId, clinicId, memberId, note?.trim() || null],
      );
      const row = result.rows[0];
      if (!row) throw await this.decisionError(clinicId, urgentCaseId, tx);
      await this.event(clinicId, row.thread_id, memberId, 'urgent_rejected', {}, tx);
      return toUrgent(row);
    });
  }

  async lockUrgentCase(clinicId: string, urgentCaseId: string, tx: SqlExecutor): Promise<UrgentRow> {
    const result = await tx.query<UrgentRow>(
      `select * from clinic.urgent_cases where id = $1 and clinic_id = $2 for update`,
      [urgentCaseId, clinicId],
    );
    const row = result.rows[0];
    if (!row) throw new MessagesError(MessagesErrorCode.UrgentCaseNotFound, 'Urgent case not found.');
    if (row.status !== 'pending') {
      throw new MessagesError(MessagesErrorCode.UrgentCaseAlreadyDecided, 'Urgent case has already been decided.');
    }
    return row;
  }

  async acceptUrgentCase(
    row: UrgentRow,
    memberId: string,
    queueEntryId: string,
    note: string | null,
    tx: SqlExecutor,
  ): Promise<UrgentCaseSummary> {
    const result = await tx.query<UrgentRow>(
      `update clinic.urgent_cases
          set status = 'accepted', decided_by_member_id = $2,
              decision_note = $3, resolved_at = now()
        where id = $1 and status = 'pending' returning *`,
      [row.id, memberId, note?.trim() || null],
    );
    await this.event(row.clinic_id, row.thread_id, memberId, 'urgent_accepted', { queueEntryId }, tx);
    await this.outbox(row.clinic_id, 'urgent_case_accepted', row.thread_id, { queueEntryId }, tx);
    return toUrgent(result.rows[0]);
  }

  private async summaryInTx(clinicId: string, memberId: string, threadId: string, tx: SqlExecutor): Promise<MessageThreadSummary> {
    const result = await tx.query<ThreadRow>(
      `${THREAD_SELECT} and t.id = $3
       group by t.id, assignee.display_name, last_message.body, urgent.id`,
      [clinicId, memberId, threadId],
    );
    return toThread(result.rows[0]);
  }

  private async requireThread(clinicId: string, threadId: string): Promise<void> {
    const result = await this.database.query(`select 1 from clinic.message_threads where id = $1 and clinic_id = $2`, [threadId, clinicId]);
    if (!result.rows[0]) throw threadNotFound();
  }

  private async lockThread(clinicId: string, threadId: string, tx: SqlExecutor): Promise<ThreadRow> {
    const result = await tx.query<ThreadRow>(
      `select * from clinic.message_threads where id = $1 and clinic_id = $2 for update`,
      [threadId, clinicId],
    );
    if (!result.rows[0]) throw threadNotFound();
    return result.rows[0];
  }

  private async lockGuardianThread(
    clinicId: string,
    guardianId: string,
    threadId: string,
    tx: SqlExecutor,
  ): Promise<ThreadRow> {
    const result = await tx.query<ThreadRow>(
      `select * from clinic.message_threads
        where id = $1 and clinic_id = $2 and guardian_id = $3
        for update`,
      [threadId, clinicId, guardianId],
    );
    if (!result.rows[0]) throw threadNotFound();
    return result.rows[0];
  }

  private async decisionError(clinicId: string, urgentCaseId: string, tx: SqlExecutor): Promise<MessagesError> {
    const found = await tx.query(`select 1 from clinic.urgent_cases where id = $1 and clinic_id = $2`, [urgentCaseId, clinicId]);
    return found.rows[0]
      ? new MessagesError(MessagesErrorCode.UrgentCaseAlreadyDecided, 'Urgent case has already been decided.')
      : new MessagesError(MessagesErrorCode.UrgentCaseNotFound, 'Urgent case not found.');
  }

  private event(clinicId: string, threadId: string, memberId: string, type: string, metadata: object, tx: SqlExecutor): Promise<unknown> {
    return tx.query(
      `insert into clinic.message_events
         (clinic_id, thread_id, event_type, actor_member_id, metadata)
       values ($1, $2, $3, $4, $5)`,
      [clinicId, threadId, type, memberId, JSON.stringify(metadata)],
    );
  }

  private guardianEvent(
    clinicId: string,
    threadId: string,
    guardianId: string,
    type: string,
    metadata: object,
    tx: SqlExecutor,
  ): Promise<unknown> {
    return tx.query(
      `insert into clinic.message_events
         (clinic_id, thread_id, event_type, actor_guardian_id, metadata)
       values ($1, $2, $3, $4, $5)`,
      [clinicId, threadId, type, guardianId, JSON.stringify(metadata)],
    );
  }

  private outbox(clinicId: string, kind: string, threadId: string, payload: object, tx: SqlExecutor): Promise<unknown> {
    return tx.query(
      `insert into clinic.notification_outbox
         (clinic_id, kind, aggregate_type, aggregate_id, payload)
       values ($1, $2, 'message_thread', $3, $4)`,
      [clinicId, kind, threadId, JSON.stringify(payload)],
    );
  }
}

function filterCondition(filter: MessageInboxFilter): string {
  switch (filter) {
    case 'open': return `and t.status = 'open'`;
    case 'urgent': return `and t.priority = 'urgent'`;
    case 'assigned': return `and t.assigned_member_id = $2`;
    case 'unread': return `and exists (
      select 1 from clinic.thread_messages um
       where um.thread_id = t.id and um.sender_guardian_id is not null
         and um.created_at > coalesce((select r.last_read_at from clinic.message_thread_reads r where r.thread_id = t.id and r.member_id = $2), '-infinity'::timestamptz)
    )`;
    default: return '';
  }
}

function toThread(row: ThreadRow): MessageThreadSummary {
  return {
    id: row.id, guardianId: row.guardian_id, childId: row.child_id,
    contactName: row.contact_name, childName: row.child_name, subject: row.subject,
    status: row.status, priority: row.priority,
    assignedMemberId: row.assigned_member_id,
    assignedMemberName: row.assigned_member_name,
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at.toISOString(),
    unreadCount: Number(row.unread_count),
    urgentCase: row.urgent_id ? {
      id: row.urgent_id,
      status: row.urgent_status as UrgentCaseSummary['status'],
      triageNote: row.triage_note ?? '',
      decisionNote: row.decision_note,
      createdAt: row.urgent_created_at?.toISOString() ?? row.last_message_at.toISOString(),
      resolvedAt: row.resolved_at?.toISOString() ?? null,
    } : null,
  };
}

function toMessage(row: MessageRow): ThreadMessage {
  return {
    id: row.id, threadId: row.thread_id,
    senderType: row.sender_member_id ? 'staff' : 'guardian',
    senderName: row.sender_name ?? 'ولي الأمر', body: row.body,
    createdAt: row.created_at.toISOString(),
  };
}

function toTemplate(row: TemplateRow): QuickReplyTemplate {
  return { id: row.id, title: row.title, body: row.body };
}

function toUrgent(row: UrgentRow): UrgentCaseSummary {
  return {
    id: row.id, status: row.status, triageNote: row.triage_note,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  };
}

function threadNotFound(): MessagesError {
  return new MessagesError(MessagesErrorCode.ThreadNotFound, 'Message thread not found.');
}

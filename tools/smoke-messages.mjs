/** End-to-end staff inbox and urgent-to-queue workflow smoke test. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const database = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
const apiUrl = (process.env.VITE_API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accounts = [];
let threadId;
let entryId;
let sessionSnapshot;

async function createAccount(role) {
  const email = `messages-${role}-${tag}@example.test`;
  const password = `Messages-${tag}-Aa1!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const member = await database.query(
    `insert into clinic.clinic_members (clinic_id, auth_user_id, role, display_name, status)
     values ($1, $2, $3, $4, 'active') returning id`,
    [sessionSnapshot.clinic_id, created.data.user.id, role, `Messages ${role}`],
  );
  const signIn = await anon.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  accounts.push({ authUserId: created.data.user.id, memberId: member.rows[0].id });
  return signIn.data.session.access_token;
}

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${apiUrl}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: response.status === 204 ? null : await response.json() };
}

try {
  await database.connect();
  const target = await database.query(
    `select s.id as session_id, s.clinic_id, s.revision, s.next_ticket_number,
            g.id as guardian_id, c.id as child_id, g.full_name as contact_name,
            c.full_name as child_name
       from clinic.clinic_sessions s
       join clinic.clinics tenant on tenant.id = s.clinic_id
       join clinic.guardians g on g.clinic_id = s.clinic_id and g.full_name like 'demo %'
       join clinic.guardian_children gc on gc.guardian_id = g.id
       join clinic.children c on c.id = gc.child_id
      where tenant.slug = $1 and s.status = 'open'
        and not exists (select 1 from clinic.queue_entries q where q.session_id = s.id and q.child_id = c.id)
      order by c.created_at desc limit 1`,
    [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
  );
  sessionSnapshot = target.rows[0];
  if (!sessionSnapshot) throw new Error('Seed the demo day before this smoke test.');
  const reception = await createAccount('reception');
  const doctor = await createAccount('doctor');

  const inbox = await request('clinic/messages?filter=unread', reception);
  if (!inbox.response.ok || inbox.payload.data.totalUnread < 2) throw new Error('Unread inbox failed.');

  const created = await request('clinic/messages/threads', reception, 'POST', {
    guardianId: sessionSnapshot.guardian_id,
    childId: sessionSnapshot.child_id,
    contactName: sessionSnapshot.contact_name,
    childName: sessionSnapshot.child_name,
    subject: 'Smoke thread',
    initialMessage: 'Initial staff note',
  });
  if (created.response.status !== 201) throw new Error(`Thread creation failed: ${JSON.stringify(created.payload)}`);
  threadId = created.payload.data.id;

  const requestId = crypto.randomUUID();
  const replies = await Promise.all([
    request(`clinic/messages/${threadId}/replies`, reception, 'POST', { body: 'Idempotent reply', clientRequestId: requestId }),
    request(`clinic/messages/${threadId}/replies`, reception, 'POST', { body: 'Idempotent reply', clientRequestId: requestId }),
  ]);
  if (replies.some((item) => !item.response.ok)) throw new Error('Concurrent reply failed.');

  await request(`clinic/messages/${threadId}/close`, reception, 'POST');
  const closedReply = await request(`clinic/messages/${threadId}/replies`, reception, 'POST', { body: 'Must fail', clientRequestId: crypto.randomUUID() });
  if (closedReply.response.status !== 409) throw new Error('Closed thread accepted a reply.');
  await request(`clinic/messages/${threadId}/reopen`, reception, 'POST');
  await request(`clinic/messages/${threadId}/assign-to-doctor`, reception, 'POST');

  const urgent = await request(`clinic/messages/${threadId}/urgent`, reception, 'POST', { triageNote: 'Smoke urgent triage' });
  if (urgent.response.status !== 201) throw new Error('Urgent escalation failed.');
  const caseId = urgent.payload.data.id;
  const forbidden = await request(`clinic/messages/urgent-cases/${caseId}/accept`, reception, 'POST', { sessionId: sessionSnapshot.session_id });
  if (forbidden.response.status !== 403) throw new Error('Reception accepted an urgent case.');

  const decisions = await Promise.all([
    request(`clinic/messages/urgent-cases/${caseId}/accept`, doctor, 'POST', { sessionId: sessionSnapshot.session_id, decisionNote: 'Admit now' }),
    request(`clinic/messages/urgent-cases/${caseId}/accept`, doctor, 'POST', { sessionId: sessionSnapshot.session_id, decisionNote: 'Admit now' }),
  ]);
  const statuses = decisions.map((item) => item.response.status).sort();
  if (statuses[0] !== 201 || statuses[1] !== 409) throw new Error(`Unexpected concurrent decision statuses: ${statuses}`);
  entryId = decisions.find((item) => item.response.ok)?.payload.data.queueEntryId;

  const proof = await database.query(
    `select
       (select count(*)::int from clinic.thread_messages where thread_id = $1 and client_request_id = $2) as replies,
       (select count(*)::int from clinic.queue_entries where id = $3 and status = 'waiting' and priority = 10) as emergency_entries,
       (select count(*)::int from clinic.message_events where thread_id = $1 and event_type = 'urgent_accepted') as accepts,
       (select count(*)::int from clinic.notification_outbox where aggregate_id = $1) as outbox`,
    [threadId, requestId, entryId],
  );
  const row = proof.rows[0];
  if (row.replies !== 1 || row.emergency_entries !== 1 || row.accepts !== 1 || row.outbox < 2) throw new Error(`Persistence proof failed: ${JSON.stringify(row)}`);
  console.log(JSON.stringify({ inbox: 200, unread: inbox.payload.data.totalUnread, idempotentReply: true, closeReopen: true, receptionAccept: 403, concurrentAccept: statuses, atomicQueueEntry: true, outbox: row.outbox }));
} finally {
  if (database._connected) {
    if (entryId) {
      await database.query(`delete from clinic.queue_events where entry_id = $1`, [entryId]);
      await database.query(`delete from clinic.queue_entries where id = $1`, [entryId]);
    }
    if (threadId) {
      await database.query(`delete from clinic.notification_outbox where aggregate_type = 'message_thread' and aggregate_id = $1`, [threadId]);
      await database.query(`delete from clinic.message_events where thread_id = $1`, [threadId]);
      await database.query(`delete from clinic.urgent_cases where thread_id = $1`, [threadId]);
      await database.query(`delete from clinic.message_thread_reads where thread_id = $1`, [threadId]);
      await database.query(`delete from clinic.thread_messages where thread_id = $1`, [threadId]);
      await database.query(`delete from clinic.message_threads where id = $1`, [threadId]);
    }
    if (sessionSnapshot) await database.query(`update clinic.clinic_sessions set revision = $2, next_ticket_number = $3 where id = $1`, [sessionSnapshot.session_id, sessionSnapshot.revision, sessionSnapshot.next_ticket_number]);
    for (const item of accounts) await database.query(`delete from clinic.clinic_members where id = $1`, [item.memberId]);
  }
  for (const item of accounts) await admin.auth.admin.deleteUser(item.authUserId);
  await database.end().catch(() => undefined);
}

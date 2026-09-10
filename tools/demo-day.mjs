/**
 * Create a repeatable Booking + Queue demo day in the pilot clinic.
 *
 * The fixture is operational rather than a pile of unrelated rows:
 * appointments and queue entries agree, every queue transition has an event,
 * and one linked parent account can see the family from the mobile app.
 *
 * Re-running `--up` replaces only rows whose names start with `demo `. Cleanup
 * and rebuild run in one transaction, so a failed seed leaves the previous
 * demo intact. Existing non-demo visits are never modified. If today's reused
 * session has no real activity, its operational state is reset to `open` so a
 * previous demo run cannot leave fresh queue rows trapped in a closed session.
 *
 *   node tools/demo-day.mjs --up
 *   node tools/demo-day.mjs --down
 *
 * Optional: DEMO_PARENT_EMAIL identifies the Auth account to link.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = 'demo';
const DEMO_PHONE = '+201555000001';
const DEFAULT_PARENT_EMAIL = 'demo.parent@example.com';

function loadEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const PATIENTS = [
  { name: `${TAG} سارة — تحت الكشف`, dob: '2022-03-14', sex: 'female' },
  { name: `${TAG} عمر — انتظار`, dob: '2019-11-02', sex: 'male' },
  { name: `${TAG} نور — طوارئ`, dob: '2025-06-20', sex: 'female' },
  { name: `${TAG} كريم — نداء منتهي`, dob: '2017-01-09', sex: 'male' },
  { name: `${TAG} ليلى — حجز مؤكد`, dob: '2021-08-12', sex: 'female' },
  { name: `${TAG} ياسين — طلب حجز`, dob: '2020-05-03', sex: 'male' },
];

async function removeDemoRows(client, clinicId) {
  const children = await client.query(
    `select id from clinic.children where clinic_id = $1 and full_name like $2`,
    [clinicId, `${TAG} %`],
  );
  const childIds = children.rows.map((row) => row.id);

  if (childIds.length > 0) {
    await client.query(
      `delete from clinic.payment_events where payment_id in (
         select id from clinic.payments where child_id = any($1::uuid[]))`,
      [childIds],
    );
    await client.query(
      `delete from clinic.payments where child_id = any($1::uuid[])`,
      [childIds],
    );
    const threads = await client.query(
      `select id from clinic.message_threads where child_id = any($1::uuid[])`,
      [childIds],
    );
    const threadIds = threads.rows.map((row) => row.id);
    if (threadIds.length > 0) {
      await client.query(
        `delete from clinic.notification_outbox
          where aggregate_type = 'message_thread' and aggregate_id = any($1::uuid[])`,
        [threadIds],
      );
      await client.query(
        `delete from clinic.message_events where thread_id = any($1::uuid[])`,
        [threadIds],
      );
      await client.query(
        `delete from clinic.urgent_cases where thread_id = any($1::uuid[])`,
        [threadIds],
      );
      await client.query(
        `delete from clinic.message_thread_reads where thread_id = any($1::uuid[])`,
        [threadIds],
      );
      await client.query(
        `delete from clinic.thread_messages where thread_id = any($1::uuid[])`,
        [threadIds],
      );
      await client.query(
        `delete from clinic.message_threads where id = any($1::uuid[])`,
        [threadIds],
      );
    }
    await client.query(
      `delete from clinic.queue_events where entry_id in (
         select id from clinic.queue_entries where child_id = any($1::uuid[]))`,
      [childIds],
    );
    await client.query(
      `delete from clinic.queue_entries where child_id = any($1::uuid[])`,
      [childIds],
    );
    await client.query(
      `delete from clinic.appointment_events where appointment_id in (
         select id from clinic.appointments where child_id = any($1::uuid[]))`,
      [childIds],
    );
    await client.query(
      `delete from clinic.appointments where child_id = any($1::uuid[])`,
      [childIds],
    );
    await client.query(
      `delete from clinic.guardian_children where child_id = any($1::uuid[])`,
      [childIds],
    );
    await client.query(
      `delete from clinic.children where id = any($1::uuid[])`,
      [childIds],
    );
  }

  await client.query(
    `delete from clinic.guardians
      where clinic_id = $1 and phone_e164 = $2 and full_name like $3
        and not exists (
          select 1 from clinic.guardian_children gc where gc.guardian_id = guardians.id)
        and not exists (
          select 1 from clinic.appointments a where a.guardian_id = guardians.id)
        and not exists (
          select 1 from clinic.queue_entries q where q.guardian_id = guardians.id)`,
    [clinicId, DEMO_PHONE, `${TAG} %`],
  );

  return childIds.length;
}

async function seedMessages(client, clinicId, memberId, family) {
  await client.query(
    `insert into clinic.quick_reply_templates (clinic_id, title, body, sort_order)
     select $1, seed.title, seed.body, seed.sort_order
       from (values
         ('تأكيد الاستلام', 'وصلتنا رسالتك، والطبيبة ستراجع التفاصيل في أقرب وقت.', 1),
         ('التوجه للطوارئ', 'إذا كانت هناك صعوبة تنفس أو فقدان وعي أو تشنج أو نزيف شديد، توجّهوا للطوارئ فورًا.', 2),
         ('طلب تفاصيل', 'من فضلك اذكري بداية الأعراض ودرجة الحرارة وأي أدوية تم أخذها.', 3)
       ) as seed(title, body, sort_order)
      where not exists (
        select 1 from clinic.quick_reply_templates q
         where q.clinic_id = $1 and q.title = seed.title
      )`,
    [clinicId],
  );

  const doctor = await client.query(
    `select id from clinic.clinic_members
      where clinic_id = $1 and role = 'doctor' and status = 'active'
      order by created_at, id limit 1`,
    [clinicId],
  );
  const doctorId = doctor.rows[0]?.id ?? memberId;

  const normal = await client.query(
    `insert into clinic.message_threads
       (clinic_id, guardian_id, child_id, contact_name, child_name, subject,
        assigned_member_id, created_by_member_id, last_message_at)
     values ($1, $2, $3, 'demo ولي الأمر', $4, 'استفسار عن الجرعة', $5, $6,
             now() - interval '12 minutes') returning id`,
    [
      clinicId,
      family.guardianId,
      family.children[1].id,
      family.children[1].full_name,
      doctorId,
      memberId,
    ],
  );
  await client.query(
    `insert into clinic.thread_messages
       (clinic_id, thread_id, sender_guardian_id, body, created_at)
     values ($1, $2, $3, 'هل أستمر على خافض الحرارة إذا تحسنت حالة عمر؟', now() - interval '12 minutes')`,
    [clinicId, normal.rows[0].id, family.guardianId],
  );
  await client.query(
    `insert into clinic.message_events
       (clinic_id, thread_id, event_type, actor_member_id, metadata, created_at)
     values ($1, $2, 'created', $3, '{"fixture":"demo-day"}'::jsonb, now() - interval '12 minutes')`,
    [clinicId, normal.rows[0].id, memberId],
  );

  const urgent = await client.query(
    `insert into clinic.message_threads
       (clinic_id, guardian_id, child_id, contact_name, child_name, subject,
        priority, assigned_member_id, created_by_member_id, last_message_at)
     values ($1, $2, $3, 'demo ولي الأمر', $4, 'حرارة مرتفعة وخمول', 'urgent', $5, $6,
             now() - interval '4 minutes') returning id`,
    [
      clinicId,
      family.guardianId,
      family.children[2].id,
      family.children[2].full_name,
      doctorId,
      memberId,
    ],
  );
  await client.query(
    `insert into clinic.thread_messages
       (clinic_id, thread_id, sender_guardian_id, body, created_at)
     values ($1, $2, $3, 'حرارة نور 39.5 ومعها خمول منذ الصباح.', now() - interval '4 minutes')`,
    [clinicId, urgent.rows[0].id, family.guardianId],
  );
  await client.query(
    `insert into clinic.urgent_cases
       (clinic_id, thread_id, child_id, guardian_id, triage_note, raised_by_member_id)
     values ($1, $2, $3, $4, 'حرارة 39.5 مع خمول — تحتاج قرار الطبيبة', $5)`,
    [
      clinicId,
      urgent.rows[0].id,
      family.children[2].id,
      family.guardianId,
      memberId,
    ],
  );
  await client.query(
    `insert into clinic.message_events
       (clinic_id, thread_id, event_type, actor_member_id, metadata, created_at)
     values
       ($1, $2, 'created', $3, '{"fixture":"demo-day"}'::jsonb, now() - interval '4 minutes'),
       ($1, $2, 'urgent_raised', $3, '{"fixture":"demo-day"}'::jsonb, now() - interval '3 minutes')`,
    [clinicId, urgent.rows[0].id, memberId],
  );
}

async function seedPayments(client, clinicId, memberId, family, appointments) {
  const samples = [
    { childIndex: 0, amount: 45000, status: 'paid' },
    { childIndex: 1, amount: 30000, status: 'refunded' },
  ];
  for (const sample of samples) {
    const payment = await client.query(
      `insert into clinic.payments
        (clinic_id, appointment_id, child_id, guardian_id, method, status,
         amount_minor, currency, idempotency_key, recorded_by_member_id,
         decided_by_member_id, paid_at, refunded_at)
       values ($1,$2,$3,$4,'cash',$5,$6,'EGP',gen_random_uuid(),$7,
               case when $5::text='refunded' then $7::uuid else null end,now(),
               case when $5::text='refunded' then now() else null end)
       returning id`,
      [
        clinicId,
        appointments.get(sample.childIndex),
        family.children[sample.childIndex].id,
        family.guardianId,
        sample.status,
        sample.amount,
        memberId,
      ],
    );
    await client.query(
      `insert into clinic.payment_events
        (clinic_id,payment_id,event_type,from_status,to_status,actor_member_id,note)
       values ($1,$2,'cash_registered',null,'paid',$3,'demo-day fixture')`,
      [clinicId, payment.rows[0].id, memberId],
    );
    if (sample.status === 'refunded') {
      await client.query(
        `insert into clinic.payment_events
          (clinic_id,payment_id,event_type,from_status,to_status,actor_member_id,note)
         values ($1,$2,'refunded','paid','refunded',$3,'demo-day fixture')`,
        [clinicId, payment.rows[0].id, memberId],
      );
    }
  }
}

async function materializeToday(client, clinicId) {
  await client.query(
    `insert into clinic.clinic_sessions (
       clinic_id, doctor_member_id, session_date, session_kind,
       planned_start, planned_end, window_minutes, capacity_per_window,
       avg_consult_minutes)
     select distinct on (s.doctor_member_id, s.session_kind)
       s.clinic_id, s.doctor_member_id, d.day, s.session_kind,
       ((d.day + s.starts_at) at time zone c.timezone),
       ((d.day + s.ends_at) at time zone c.timezone),
       s.window_minutes, s.capacity_per_window,
       c.default_avg_consult_minutes
     from (
       select (now() at time zone c0.timezone)::date as day
         from clinic.clinics c0 where c0.id = $1
     ) d
     join clinic.clinic_schedules s
       on s.clinic_id = $1 and s.active
      and s.weekday = extract(dow from d.day)
      and s.effective_from <= d.day
      and (s.effective_to is null or s.effective_to >= d.day)
     join clinic.clinics c on c.id = s.clinic_id
     order by s.doctor_member_id, s.session_kind, s.effective_from desc
     on conflict (clinic_id, doctor_member_id, session_date, session_kind)
     do nothing`,
    [clinicId],
  );

  const session = await client.query(
    `select s.*
       from clinic.clinic_sessions s
       join clinic.clinics c on c.id = s.clinic_id
      where s.clinic_id = $1
        and s.session_date = (now() at time zone c.timezone)::date
      order by s.planned_start, s.id
      limit 1
      for update of s`,
    [clinicId],
  );
  if (session.rowCount === 0) {
    throw new Error(
      'The clinic has no schedule today, so a demo session cannot be created.',
    );
  }
  return session.rows[0];
}

async function assertSessionHasNoRealActivity(client, sessionId) {
  const activity = await client.query(
    `select
       (select count(*)::int
          from clinic.appointments a
          join clinic.children ch on ch.id = a.child_id
         where a.session_id = $1 and ch.full_name not like $2) as appointments,
       (select count(*)::int
          from clinic.queue_entries q
          join clinic.children ch on ch.id = q.child_id
         where q.session_id = $1 and ch.full_name not like $2) as queue_entries`,
    [sessionId, `${TAG} %`],
  );
  const row = activity.rows[0];
  if (row.appointments > 0 || row.queue_entries > 0) {
    throw new Error(
      "Today's session already contains non-demo activity. Refusing to change its operational state.",
    );
  }
}

async function createFamily(client, clinicId, memberId) {
  const parentEmail = process.env.DEMO_PARENT_EMAIL ?? DEFAULT_PARENT_EMAIL;
  const auth = await client.query(
    `select id from auth.users where lower(email) = lower($1) limit 1`,
    [parentEmail],
  );
  const authUserId = auth.rows[0]?.id ?? null;
  const guardian = await client.query(
    `insert into clinic.guardians (
       clinic_id, auth_user_id, full_name, phone_e164, phone_raw, email,
       default_relationship, claimed_at, claimed_via, created_by_member_id)
     values (
       $1, $2, $3, $4, $4, $5, 'mother',
       case when $2::uuid is null then null else now() end,
       case when $2::uuid is null then null else 'self_signup' end,
       $6)
     returning id`,
    [
      clinicId,
      authUserId,
      `${TAG} ولي الأمر`,
      DEMO_PHONE,
      parentEmail,
      memberId,
    ],
  );

  const children = [];
  for (const patient of PATIENTS) {
    const child = await client.query(
      `insert into clinic.children (
         clinic_id, full_name, date_of_birth, sex, created_by_member_id)
       values ($1, $2, $3::date, $4, $5)
       returning id, full_name`,
      [clinicId, patient.name, patient.dob, patient.sex, memberId],
    );
    children.push(child.rows[0]);
    await client.query(
      `insert into clinic.guardian_children (
         guardian_id, child_id, relationship, is_primary)
       values ($1, $2, 'mother', true)`,
      [guardian.rows[0].id, child.rows[0].id],
    );
  }
  return {
    guardianId: guardian.rows[0].id,
    children,
    parentEmail,
    authLinked: !!authUserId,
  };
}

async function createAppointment(
  client,
  {
    clinicId,
    session,
    childId,
    guardianId,
    memberId,
    seatNo,
    status,
    visitType,
  },
) {
  const appointment = await client.query(
    `insert into clinic.appointments (
       clinic_id, session_id, child_id, guardian_id,
       window_start, window_end, seat_no, visit_type, status,
       notes, created_by_member_id)
     values (
       $1, $2, $3, $4, $5,
       $5::timestamptz + make_interval(mins => $6::int),
       $7, $8, $9, $10, $11)
     returning id`,
    [
      clinicId,
      session.id,
      childId,
      guardianId,
      session.planned_start,
      session.window_minutes,
      seatNo,
      visitType,
      status,
      `${TAG}: ${status}`,
      memberId,
    ],
  );
  await client.query(
    `insert into clinic.appointment_events (
       appointment_id, event_type, from_status, to_status,
       performed_by_member_id, metadata)
     values ($1, 'demo_seeded', null, $2, $3, '{"fixture":"demo-day"}'::jsonb)`,
    [appointment.rows[0].id, status, memberId],
  );
  return appointment.rows[0].id;
}

async function createQueueEntry(client, input) {
  const entry = await client.query(
    `insert into clinic.queue_entries (
       clinic_id, session_id, appointment_id, child_id, guardian_id,
       source, ticket_number, sort_key, priority, status, visit_reason,
       checked_in_at, called_at, grace_expires_at, started_at,
       emergency_reason, emergency_marked_by, emergency_marked_at,
       created_by_member_id)
     values (
       $1, $2, $3, $4, $5,
       case when $3::uuid is null then 'walk_in' else 'appointment' end,
       $6, $7, $8, $9, $10,
       now() - interval '35 minutes',
       case when $11::int is null then null else now() - make_interval(mins => $11::int) end,
       case when $11::int is null then null
            else now() - make_interval(mins => $11::int) + make_interval(mins => $12::int) end,
       case when $9 = 'in_service' then now() - interval '8 minutes' else null end,
       $13, case when $13::text is null then null else $14::uuid end,
       case when $13::text is null then null else now() - interval '20 minutes' end,
       $14::uuid)
     returning id`,
    [
      input.clinicId,
      input.sessionId,
      input.appointmentId,
      input.childId,
      input.guardianId,
      input.ticket,
      input.sortKey,
      input.priority ?? 100,
      input.status,
      `${TAG}: ${input.status}`,
      input.calledMinutesAgo ?? null,
      input.graceMinutes,
      input.emergencyReason ?? null,
      input.memberId,
    ],
  );
  const entryId = entry.rows[0].id;
  await client.query(
    `insert into clinic.queue_events (
       entry_id, session_id, event_type, from_status, to_status,
       performed_by_member_id, metadata, created_at)
     values ($1, $2, 'checked_in', null, 'waiting', $3,
             '{"fixture":"demo-day"}'::jsonb, now() - interval '35 minutes')`,
    [entryId, input.sessionId, input.memberId],
  );
  if ((input.priority ?? 100) < 100) {
    await client.query(
      `insert into clinic.queue_events (
         entry_id, session_id, event_type, from_status, to_status,
         performed_by_member_id, reason, metadata, created_at)
       values ($1, $2, 'emergency_set', 'waiting', 'waiting', $3, $4,
               '{"fixture":"demo-day"}'::jsonb, now() - interval '20 minutes')`,
      [entryId, input.sessionId, input.memberId, input.emergencyReason],
    );
  }
  if (input.status === 'called' || input.status === 'in_service') {
    await client.query(
      `insert into clinic.queue_events (
         entry_id, session_id, event_type, from_status, to_status,
         performed_by_member_id, metadata, created_at)
       values ($1, $2, 'called', 'waiting', 'called', $3,
               '{"fixture":"demo-day"}'::jsonb,
               now() - make_interval(mins => $4::int))`,
      [entryId, input.sessionId, input.memberId, input.calledMinutesAgo],
    );
  }
  if (input.status === 'in_service') {
    await client.query(
      `insert into clinic.queue_events (
         entry_id, session_id, event_type, from_status, to_status,
         performed_by_member_id, metadata, created_at)
       values ($1, $2, 'started', 'called', 'in_service', $3,
               '{"fixture":"demo-day"}'::jsonb, now() - interval '8 minutes')`,
      [entryId, input.sessionId, input.memberId],
    );
  }
}

async function up(client, clinicId) {
  await removeDemoRows(client, clinicId);
  const session = await materializeToday(client, clinicId);
  await assertSessionHasNoRealActivity(client, session.id);
  await client.query(
    `update clinic.clinic_sessions
        set status = 'open',
            opened_at = coalesce(opened_at, now()),
            closed_at = null,
            doctor_presence = 'arrived',
            delay_minutes = null,
            delay_note = null,
            revision = revision + 1
      where id = $1`,
    [session.id],
  );

  const actor = await client.query(
    `select id from clinic.clinic_members
      where clinic_id = $1 and status = 'active'
      order by case role when 'reception' then 0 when 'admin' then 1 else 2 end,
               created_at, id
      limit 1`,
    [clinicId],
  );
  if (actor.rowCount === 0) {
    throw new Error(
      'The clinic has no active staff member. Run pnpm bootstrap:staff first.',
    );
  }
  const memberId = actor.rows[0].id;
  const family = await createFamily(client, clinicId, memberId);

  const appointmentChildren = [0, 1, 3, 4, 5];
  const appointmentStatuses = [
    'checked_in',
    'checked_in',
    'checked_in',
    'confirmed',
    'requested',
  ];
  const appointmentTypes = [
    'consultation',
    'follow_up',
    'new_visit',
    'vaccination',
    'newborn',
  ];
  const appointments = new Map();
  for (const [seatIndex, childIndex] of appointmentChildren.entries()) {
    appointments.set(
      childIndex,
      await createAppointment(client, {
        clinicId,
        session,
        childId: family.children[childIndex].id,
        guardianId: family.guardianId,
        memberId,
        seatNo: seatIndex + 1,
        status: appointmentStatuses[seatIndex],
        visitType: appointmentTypes[seatIndex],
      }),
    );
  }

  const queueRows = [
    {
      childIndex: 0,
      ticket: 1,
      sortKey: 1000,
      status: 'in_service',
      calledMinutesAgo: 12,
    },
    { childIndex: 1, ticket: 2, sortKey: 2000, status: 'waiting' },
    {
      childIndex: 2,
      ticket: 3,
      sortKey: 3000,
      priority: 10,
      status: 'waiting',
      emergencyReason: 'ارتفاع حرارة شديد — بيانات تجريبية',
    },
    {
      childIndex: 3,
      ticket: 4,
      sortKey: 4000,
      status: 'called',
      calledMinutesAgo: 20,
    },
  ];
  for (const row of queueRows) {
    await createQueueEntry(client, {
      clinicId,
      sessionId: session.id,
      appointmentId: appointments.get(row.childIndex) ?? null,
      childId: family.children[row.childIndex].id,
      guardianId: family.guardianId,
      memberId,
      graceMinutes: 10,
      ...row,
    });
  }

  await seedMessages(client, clinicId, memberId, family);
  await seedPayments(client, clinicId, memberId, family, appointments);

  await client.query(
    `update clinic.clinic_sessions
        set status = 'open', doctor_presence = 'arrived',
            presence_updated_at = now(), opened_at = coalesce(opened_at, now()),
            next_ticket_number = 5, revision = 8
      where id = $1`,
    [session.id],
  );

  console.log(`Seeded ${PATIENTS.length} demo children into today's session.`);
  console.log('Queue: 1 in service, 2 waiting (1 emergency), 1 expired call.');
  console.log('Booking: 3 checked in, 1 confirmed, 1 requested.');
  console.log('Messages: 2 unread threads, including 1 pending urgent case.');
  console.log('Payments: 1 paid cash record and 1 refunded cash record.');
  console.log(
    family.authLinked
      ? `Mobile guardian linked to ${family.parentEmail}.`
      : `No Auth user named ${family.parentEmail}; the guardian remains unclaimed.`,
  );
  console.log(
    'Re-run safely with pnpm demo:day; remove rows with pnpm demo:day:down.',
  );
}

async function down(client, clinicId) {
  const removed = await removeDemoRows(client, clinicId);
  console.log(
    `Removed ${removed} demo children and their Booking/Queue history.`,
  );
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set.');
  const direction = process.argv.includes('--down') ? down : up;
  const client = new pg.Client({
    connectionString: url,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();
  try {
    await client.query('begin');
    const clinic = await client.query(
      `select id from clinic.clinics where slug = $1 for update`,
      [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
    );
    if (clinic.rowCount === 0) throw new Error('No such clinic.');
    await direction(client, clinic.rows[0].id);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

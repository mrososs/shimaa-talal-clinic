/** End-to-end clinical API smoke test against the disposable demo patient. */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
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

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);
const anon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);
const database = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
});
const apiUrl = (
  process.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'
).replace(/\/$/, '');
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `clinical-${tag}@example.test`;
const password = `Clinical-${tag}-Aa1!`;
let authUserId;
let memberId;
let original;

async function request(path, token, method = 'GET', body) {
  const response = await fetch(`${apiUrl}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

try {
  if (!existsSync(join(root, '.env'))) throw new Error('.env is required.');
  await database.connect();
  const target = await database.query(
    `select a.id as appointment_id, a.child_id, a.status as appointment_status,
            q.id as entry_id, q.session_id, q.status as queue_status,
            q.completed_at, q.updated_at, s.revision, c.id as clinic_id
       from clinic.queue_entries q
       join clinic.appointments a on a.id = q.appointment_id
       join clinic.clinic_sessions s on s.id = q.session_id
       join clinic.clinics c on c.id = q.clinic_id
      where c.slug = $1 and q.status = 'in_service'
      order by q.created_at limit 1`,
    [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
  );
  original = target.rows[0];
  if (!original) throw new Error('Seed an in-service demo appointment first.');

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  authUserId = created.data.user.id;
  memberId = (
    await database.query(
      `insert into clinic.clinic_members
         (clinic_id, auth_user_id, role, display_name, status)
       values ($1, $2, 'doctor', 'Clinical smoke', 'active') returning id`,
      [original.clinic_id, authUserId],
    )
  ).rows[0].id;
  const signIn = await anon.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const token = signIn.data.session.access_token;
  const base = `clinic/appointments/${original.appointment_id}/clinical-record`;
  const record = await request(base, token);
  if (!record.response.ok || record.body.data.encounter !== null) {
    throw new Error('Initial clinical record read failed.');
  }
  const measurement = await request(
    `clinic/children/${original.child_id}/measurements`,
    token,
    'POST',
    { appointmentId: original.appointment_id, weightKg: 15.9, heightCm: 103.5 },
  );
  if (measurement.response.status !== 201)
    throw new Error('Measurement create failed.');

  const note = {
    diagnosis: 'Smoke diagnosis',
    investigations: '',
    treatmentInstructions: 'Smoke treatment',
    growthObservation: '',
    followUpDays: 7,
    parentSummary: 'Smoke parent summary',
  };
  const draft = await request(`${base}/draft`, token, 'PUT', note);
  if (!draft.response.ok || draft.body.data.status !== 'draft') {
    throw new Error('Draft save failed.');
  }

  await database.query(
    `update clinic.clinic_members set role = 'reception' where id = $1`,
    [memberId],
  );
  const forbidden = await request(base, token);
  if (forbidden.response.status !== 403)
    throw new Error('Reception clinical read was not forbidden.');
  const receptionMeasurement = await request(
    `clinic/children/${original.child_id}/measurements`,
    token,
    'POST',
    { temperatureC: 37.2 },
  );
  if (receptionMeasurement.response.status !== 201) {
    throw new Error('Reception measurement capture failed.');
  }
  await database.query(
    `update clinic.clinic_members set role = 'doctor' where id = $1`,
    [memberId],
  );

  const finalized = await request(`${base}/finalize`, token, 'POST', note);
  if (!finalized.response.ok || finalized.body.data.status !== 'final') {
    throw new Error('Encounter finalize failed.');
  }
  const consistent = await database.query(
    `select a.status as appointment_status, q.status as queue_status,
            e.status as encounter_status,
            (select count(*)::int from clinic.clinical_encounter_versions v
              where v.encounter_id = e.id) as versions
       from clinic.appointments a
       join clinic.queue_entries q on q.appointment_id = a.id
       join clinic.clinical_encounters e on e.appointment_id = a.id
      where a.id = $1`,
    [original.appointment_id],
  );
  const result = consistent.rows[0];
  if (
    result?.appointment_status !== 'completed' ||
    result?.queue_status !== 'done' ||
    result?.encounter_status !== 'final' ||
    result?.versions !== 2
  ) {
    throw new Error('Clinical/Booking/Queue finalization was not atomic.');
  }
  console.log(
    JSON.stringify({
      read: 200,
      measurement: 201,
      draft: 200,
      receptionRead: 403,
      receptionMeasurement: 201,
      finalize: 201,
      atomic: true,
    }),
  );
} finally {
  if (database._connected && memberId && original) {
    await database.query(
      `delete from clinic.clinical_encounter_versions
        where encounter_id in (select id from clinic.clinical_encounters where appointment_id = $1)`,
      [original.appointment_id],
    );
    await database.query(
      `delete from clinic.clinical_encounters where appointment_id = $1`,
      [original.appointment_id],
    );
    await database.query(
      `delete from clinic.clinical_measurements where recorded_by_member_id = $1`,
      [memberId],
    );
    await database.query(
      `delete from clinic.appointment_events where performed_by_member_id = $1`,
      [memberId],
    );
    await database.query(
      `delete from clinic.queue_events where performed_by_member_id = $1`,
      [memberId],
    );
    await database.query(
      `update clinic.appointments set status = $2 where id = $1`,
      [original.appointment_id, original.appointment_status],
    );
    await database.query(
      `update clinic.queue_entries set status = $2, completed_at = $3, updated_at = $4 where id = $1`,
      [
        original.entry_id,
        original.queue_status,
        original.completed_at,
        original.updated_at,
      ],
    );
    await database.query(
      `update clinic.clinic_sessions set revision = $2 where id = $1`,
      [original.session_id, original.revision],
    );
    await database.query(`delete from clinic.clinic_members where id = $1`, [
      memberId,
    ]);
  }
  if (authUserId) await admin.auth.admin.deleteUser(authUserId);
  await database.end().catch(() => undefined);
}

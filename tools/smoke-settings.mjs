/** End-to-end settings roles, audit and effective-dated schedule smoke test. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined)
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  ),
  anon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  ),
  db = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  }),
  api = (process.env.VITE_API_URL ?? 'http://localhost:3000/api/v1').replace(
    /\/$/,
    '',
  );
const accounts = [];
let clinic, createdSchedule, createdClosure, oldSchedule;
async function account(role) {
  const tag = crypto.randomUUID(),
    email = `settings-${role}-${tag}@example.test`,
    password = `Settings-${tag}-Aa1!`,
    u = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
  if (u.error) throw u.error;
  const m = await db.query(
    `insert into clinic.clinic_members(clinic_id,auth_user_id,role,display_name,status) values($1,$2,$3,$4,'active') returning id,display_name`,
    [clinic.id, u.data.user.id, role, `Settings ${role}`],
  );
  const login = await anon.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  accounts.push({ user: u.data.user.id, member: m.rows[0].id });
  return { token: login.data.session.access_token, ...m.rows[0] };
}
async function request(path, token, method = 'GET', body) {
  const r = await fetch(`${api}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, payload: await r.json() };
}
try {
  await db.connect();
  clinic = (
    await db.query(
      `select id,name,phone_e164,address from clinic.clinics where slug=$1`,
      [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
    )
  ).rows[0];
  const doctor = await account('doctor'),
    reception = await account('reception');
  const read = await request('clinic/settings', doctor.token),
    blocked = await request('clinic/settings', reception.token);
  if (read.status !== 200 || blocked.status !== 403)
    throw new Error('Settings read role enforcement failed.');
  const settings = read.payload.data;
  await request('clinic/settings/profile', doctor.token, 'PATCH', {
    name: clinic.name,
    phoneE164: clinic.phone_e164 ?? undefined,
    address: clinic.address ?? undefined,
  });
  const price = settings.prices[0];
  await request(
    `clinic/settings/prices/${price.visitType}`,
    doctor.token,
    'PUT',
    { amountMinor: price.amountMinor, active: price.active },
  );
  await request(
    `clinic/settings/team/${doctor.id}`,
    doctor.token,
    'PATCH',
    { displayName: doctor.display_name, role: 'doctor', status: 'active' },
  );
  const current = settings.schedules.find(
    (s) =>
      s.doctorMemberId ===
        settings.team.find((m) => m.role === 'doctor' && m.status === 'active')
          ?.id && s.active,
  );
  if (!current) throw new Error('No active schedule fixture.');
  oldSchedule = (
    await db.query(
      'select id,effective_to from clinic.clinic_schedules where id=$1',
      [current.id],
    )
  ).rows[0];
  const future = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10),
    sessionsBefore = Number(
      (
        await db.query(
          'select count(*) total from clinic.clinic_sessions where clinic_id=$1',
          [clinic.id],
        )
      ).rows[0].total,
    );
  const scheduled = await request(
    'clinic/settings/schedules',
    doctor.token,
    'POST',
    {
      doctorMemberId: current.doctorMemberId,
      weekday: current.weekday,
      sessionKind: current.sessionKind,
      startsAt: current.startsAt.slice(0, 8),
      endsAt: current.endsAt.slice(0, 8),
      windowMinutes: current.windowMinutes,
      capacityPerWindow: current.capacityPerWindow,
      effectiveFrom: future,
    },
  );
  if (scheduled.status !== 201)
    throw new Error(`Schedule failed ${JSON.stringify(scheduled.payload)}`);
  createdSchedule = scheduled.payload.data.schedules.find(
    (s) =>
      s.effectiveFrom === future && s.doctorMemberId === current.doctorMemberId,
  )?.id;
  const sessionsAfter = Number(
    (
      await db.query(
        'select count(*) total from clinic.clinic_sessions where clinic_id=$1',
        [clinic.id],
      )
    ).rows[0].total,
  );
  if (sessionsAfter !== sessionsBefore)
    throw new Error('Schedule rewrite changed materialized sessions.');
  const start = new Date(Date.now() + 60 * 86400000),
    end = new Date(start.getTime() + 3600000),
    closed = await request('clinic/settings/closures', doctor.token, 'POST', {
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      reason: 'settings smoke',
    });
  if (closed.status !== 201) throw new Error('Closure failed.');
  createdClosure = closed.payload.data.closures.find(
    (c) => c.reason === 'settings smoke',
  )?.id;
  const audit = await request('clinic/settings/audit', doctor.token);
  if (
    audit.status !== 200 ||
    audit.payload.data.filter((e) => e.actorName === doctor.display_name)
      .length < 5
  )
    throw new Error(`Audit coverage failed: ${JSON.stringify(audit)}`);
  console.log(
    JSON.stringify({
      doctorRead: 200,
      receptionRead: 403,
      mutationsAudited: true,
      effectiveDatedSchedule: true,
      materializedSessionsUnchanged: true,
    }),
  );
} finally {
  if (db._connected) {
    if (createdClosure)
      await db.query('delete from clinic.clinic_closures where id=$1', [
        createdClosure,
      ]);
    if (createdSchedule)
      await db.query('delete from clinic.clinic_schedules where id=$1', [
        createdSchedule,
      ]);
    if (oldSchedule)
      await db.query(
        'update clinic.clinic_schedules set effective_to=$2 where id=$1',
        [oldSchedule.id, oldSchedule.effective_to],
      );
    for (const a of accounts) {
      await db.query(
        'delete from clinic.audit_events where actor_member_id=$1',
        [a.member],
      );
      await db.query('delete from clinic.clinic_members where id=$1', [
        a.member,
      ]);
    }
  }
  for (const a of accounts) await admin.auth.admin.deleteUser(a.user);
  await db.end().catch(() => undefined);
}

/** End-to-end Payments + Reports smoke test. Creates and removes its own rows. */
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
const accounts = [],
  paymentIds = [],
  objects = [];
let target;
async function account(role) {
  const tag = crypto.randomUUID(),
    email = `payment-${role}-${tag}@example.test`,
    password = `Payment-${tag}-Aa1!`,
    created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
  if (created.error) throw created.error;
  const member = await db.query(
    `insert into clinic.clinic_members(clinic_id,auth_user_id,role,display_name,status) values($1,$2,$3,$4,'active') returning id`,
    [target.clinic_id, created.data.user.id, role, `Payment ${role}`],
  );
  const login = await anon.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  accounts.push({ user: created.data.user.id, member: member.rows[0].id });
  return login.data.session.access_token;
}
async function request(path, token, method = 'GET', body) {
  const multipart = body instanceof FormData,
    res = await fetch(`${api}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(!body || multipart ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
    });
  return { status: res.status, payload: await res.json() };
}
try {
  await db.connect();
  target = (
    await db.query(
      `select a.id appointment_id,a.clinic_id,a.child_id,a.guardian_id,c.timezone,(now() at time zone c.timezone)::date::text today from clinic.appointments a join clinic.clinics c on c.id=a.clinic_id join clinic.children ch on ch.id=a.child_id where c.slug=$1 and ch.full_name like 'demo %' order by a.created_at limit 1`,
      [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
    )
  ).rows[0];
  if (!target) throw new Error('Seed demo day first.');
  const doctor = await account('doctor'),
    reception = await account('reception'),
    base = {
      appointmentId: target.appointment_id,
      childId: target.child_id,
      guardianId: target.guardian_id,
      amountMinor: 12345,
      currency: 'EGP',
    };
  const key = crypto.randomUUID(),
    [cash1, cash2] = await Promise.all([
      request('clinic/payments/cash', doctor, 'POST', {
        ...base,
        idempotencyKey: key,
      }),
      request('clinic/payments/cash', doctor, 'POST', {
        ...base,
        idempotencyKey: key,
      }),
    ]);
  if (
    cash1.status !== 201 ||
    cash2.status !== 201 ||
    cash1.payload.data.id !== cash2.payload.data.id
  )
    throw new Error('Cash idempotency failed.');
  paymentIds.push(cash1.payload.data.id);
  await request(`clinic/payments/${paymentIds[0]}/refund`, doctor, 'POST', {});
  await request(`clinic/payments/${paymentIds[0]}/refund`, doctor, 'POST', {});
  const form = new FormData();
  for (const [k, v] of Object.entries({
    ...base,
    idempotencyKey: crypto.randomUUID(),
  }))
    form.append(k, String(v));
  form.append(
    'file',
    new Blob(['%PDF-1.4\n%%EOF'], { type: 'application/pdf' }),
    'receipt.pdf',
  );
  const instant = await request(
    'clinic/payments/instapay',
    reception,
    'POST',
    form,
  );
  if (instant.status !== 201)
    throw new Error(
      `InstaPay upload failed ${JSON.stringify(instant.payload)}`,
    );
  paymentIds.push(instant.payload.data.id);
  const path = (
    await db.query(
      'select receipt_object_path from clinic.payments where id=$1',
      [instant.payload.data.id],
    )
  ).rows[0].receipt_object_path;
  objects.push(path);
  const [approve1, approve2] = await Promise.all([
    request(
      `clinic/payments/${instant.payload.data.id}/approve`,
      doctor,
      'POST',
      {},
    ),
    request(
      `clinic/payments/${instant.payload.data.id}/approve`,
      doctor,
      'POST',
      {},
    ),
  ]);
  if (approve1.status !== 201 || approve2.status !== 201)
    throw new Error('Approve idempotency failed.');
  const reject = await request(
      `clinic/payments/${instant.payload.data.id}/reject`,
      doctor,
      'POST',
      {},
    ),
    forbidden = await request(
      `clinic/payments/${instant.payload.data.id}/refund`,
      reception,
      'POST',
      {},
    );
  if (reject.status !== 409 || forbidden.status !== 403)
    throw new Error('Transition/role guard failed.');
  const doctorReport = await request(
      `clinic/reports?from=${target.today}&to=${target.today}`,
      doctor,
    ),
    receptionReport = await request(
      `clinic/reports?from=${target.today}&to=${target.today}`,
      reception,
    );
  if (
    doctorReport.status !== 200 ||
    !doctorReport.payload.data.financial ||
    receptionReport.payload.data.financial !== null
  )
    throw new Error(
      `Report role projection failed: ${JSON.stringify({ doctor: doctorReport, reception: receptionReport })}`,
    );
  const events = (
    await db.query(
      `select event_type,count(*)::int total from clinic.payment_events where payment_id=any($1::uuid[]) group by event_type`,
      [paymentIds],
    )
  ).rows;
  console.log(
    JSON.stringify({
      cashIdempotent: true,
      instapayUploaded: true,
      approveIdempotent: true,
      illegalTransition: 409,
      receptionRefund: 403,
      doctorFinancial: true,
      receptionFinancialHidden: true,
      events,
    }),
  );
} finally {
  if (db._connected && paymentIds.length) {
    await db.query(
      'delete from clinic.payment_events where payment_id=any($1::uuid[])',
      [paymentIds],
    );
    await db.query('delete from clinic.payments where id=any($1::uuid[])', [
      paymentIds,
    ]);
  }
  if (objects.length)
    await admin.storage.from('clinic-payment-receipts').remove(objects);
  if (db._connected)
    for (const a of accounts)
      await db.query('delete from clinic.clinic_members where id=$1', [
        a.member,
      ]);
  for (const a of accounts) await admin.auth.admin.deleteUser(a.user);
  await db.end().catch(() => undefined);
}

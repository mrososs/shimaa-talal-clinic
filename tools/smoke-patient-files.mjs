/** Repeatable end-to-end smoke test for the private patient attachment flow. */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const anon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const database = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
});
const apiUrl =
  `${process.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'}`.replace(
    /\/$/,
    '',
  );
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `patient-files-${tag}@example.test`;
const password = `Smoke-${tag}-Aa1!`;
let authUserId;
let memberId;
let objectPath;

async function api(path, token, init = {}) {
  const response = await fetch(`${apiUrl}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = await response.json();
  return { response, body };
}

try {
  await database.connect();
  const clinic = await database.query(
    `select id from clinic.clinics where slug = $1`,
    [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
  );
  const clinicId = clinic.rows[0]?.id;
  if (!clinicId) throw new Error('Smoke clinic not found.');
  const child = await database.query(
    `select id from clinic.children where clinic_id = $1 order by id limit 1`,
    [clinicId],
  );
  const childId = child.rows[0]?.id;
  if (!childId)
    throw new Error('Smoke child not found; seed the demo day first.');

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  authUserId = created.data.user.id;
  const member = await database.query(
    `insert into clinic.clinic_members
       (clinic_id, auth_user_id, role, display_name, status)
     values ($1, $2, 'doctor', 'Patient file smoke', 'active') returning id`,
    [clinicId, authUserId],
  );
  memberId = member.rows[0].id;

  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const token = signedIn.data.session.access_token;
  const form = new FormData();
  form.append(
    'file',
    new Blob(['%PDF-1.4\nprivate smoke report'], { type: 'application/pdf' }),
    'smoke.pdf',
  );
  const uploaded = await api(`clinic/children/${childId}/files`, token, {
    method: 'POST',
    body: form,
  });
  if (!uploaded.response.ok || !uploaded.body.success) {
    throw new Error(`Upload failed with ${uploaded.response.status}.`);
  }

  const fileId = uploaded.body.data.id;
  const metadata = await database.query(
    `select object_path from clinic.patient_files where id = $1`,
    [fileId],
  );
  objectPath = metadata.rows[0]?.object_path;
  const listed = await api(`clinic/children/${childId}/files`, token);
  const downloaded = await api(
    `clinic/children/${childId}/files/${fileId}/download`,
    token,
  );
  if (!listed.body.data?.some((file) => file.id === fileId)) {
    throw new Error('Uploaded file was not listed.');
  }
  if (
    !downloaded.body.data?.url ||
    downloaded.body.data.url.includes(process.env.SUPABASE_SECRET_KEY)
  ) {
    throw new Error('A safe signed download URL was not returned.');
  }

  await database.query(
    `update clinic.clinic_members set role = 'reception' where id = $1`,
    [memberId],
  );
  const forbidden = await api(`clinic/children/${childId}/files`, token);
  if (forbidden.response.status !== 403) {
    throw new Error(
      `Reception access returned ${forbidden.response.status}, expected 403.`,
    );
  }

  console.log(
    JSON.stringify({ upload: 201, list: 200, download: 200, reception: 403 }),
  );
} finally {
  if (objectPath)
    await admin.storage.from('clinic-patient-files').remove([objectPath]);
  if (memberId) {
    await database.query(
      `delete from clinic.patient_files where uploaded_by_member_id = $1`,
      [memberId],
    );
    await database.query(`delete from clinic.clinic_members where id = $1`, [
      memberId,
    ]);
  }
  if (authUserId) await admin.auth.admin.deleteUser(authUserId);
  await database.end().catch(() => undefined);
}

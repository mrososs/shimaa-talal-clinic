/**
 * Provision dedicated dashboard/mobile demo accounts in Supabase Auth.
 *
 * Existing users are never modified and their passwords are never reset. Set
 * DEMO_ACCOUNT_PASSWORD only for the first run; it stays outside source
 * control and is sent only to Supabase's server-side Admin API.
 *
 *   DEMO_ACCOUNT_PASSWORD='<strong temporary password>' pnpm demo:accounts
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ACCOUNTS = [
  {
    email: 'demo.doctor@example.com',
    displayName: 'طبيب تجريبي',
    role: 'doctor',
  },
  {
    email: 'demo.reception@example.com',
    displayName: 'استقبال تجريبي',
    role: 'reception',
  },
  {
    email: 'demo.parent@example.com',
    displayName: 'ولي أمر تجريبي',
    role: null,
  },
];

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

async function main() {
  loadEnv();
  const databaseUrl = process.env.MIGRATION_DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!databaseUrl || !supabaseUrl || !secretKey) {
    throw new Error(
      'MIGRATION_DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY are required.',
    );
  }

  const database = new pg.Client({
    connectionString: databaseUrl,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await database.connect();
  try {
    const clinic = await database.query(
      `select id from clinic.clinics where slug = $1`,
      [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
    );
    if (clinic.rowCount === 0) throw new Error('No such clinic.');

    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const password = process.env.DEMO_ACCOUNT_PASSWORD;
    const accountIds = new Map();

    for (const account of ACCOUNTS) {
      const existing = await database.query(
        `select id from auth.users where lower(email) = lower($1) limit 1`,
        [account.email],
      );
      if (existing.rowCount > 0) {
        accountIds.set(account.email, existing.rows[0].id);
        console.log(`Demo account already exists: ${account.email}`);
        continue;
      }
      if (!password || password.length < 12) {
        throw new Error(
          'Set DEMO_ACCOUNT_PASSWORD to at least 12 characters when creating accounts.',
        );
      }
      const { data, error } = await supabase.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: account.displayName },
        app_metadata: { fixture: 'demo-account' },
      });
      if (error) throw error;
      accountIds.set(account.email, data.user.id);
      console.log(`Created and confirmed demo account: ${account.email}`);
    }

    await database.query('begin');
    try {
      for (const account of ACCOUNTS.filter(({ role }) => role !== null)) {
        await database.query(
          `insert into clinic.clinic_members (
             clinic_id, auth_user_id, role, display_name, status)
           values ($1, $2, $3, $4, 'active')
           on conflict (clinic_id, auth_user_id) do update
             set role = excluded.role,
                 display_name = excluded.display_name,
                 status = 'active'`,
          [
            clinic.rows[0].id,
            accountIds.get(account.email),
            account.role,
            account.displayName,
          ],
        );
      }
      await database.query('commit');
    } catch (error) {
      await database.query('rollback');
      throw error;
    }
    console.log(
      'Demo staff memberships are active. Existing passwords were unchanged.',
    );
  } finally {
    await database.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

/**
 * Link existing Supabase Auth users to a clinic as staff.
 *
 * NOT a migration, on purpose. Which people work at which clinic is
 * environment-specific fact, not schema: staging and production have different
 * humans, and a migration that carried one environment's staff would be wrong
 * everywhere else and unrunnable on a fresh database where those accounts do
 * not exist. Migrations describe structure; this describes a deployment.
 *
 * Idempotent. Re-running changes a role if it moved and does nothing otherwise;
 * it never creates a second membership for the same person at the same clinic —
 * `clinic_members_clinic_user_uq` guarantees that even if this script is wrong.
 *
 * Auth users are matched by EMAIL and their ids are never written down here. An
 * id belongs to one environment; a script carrying one only runs in that
 * environment, and printing one puts it in a terminal history for no reason.
 *
 * ## Running it
 *
 *   pnpm bootstrap:staff
 *   pnpm bootstrap:staff -- --clinic=<slug> --doctor=<email> --reception=<email>
 *
 * It uses MIGRATION_DATABASE_URL — the owner connection — because creating a
 * clinic member is an administrative act. The application's `clinic_api` role
 * has no business reading `auth.users`, and after this runs it never needs to:
 * `clinic_members.auth_user_id` is a plain column it can read on its own.
 *
 * ## In another environment
 *
 * Create the accounts in that project's Supabase Auth, set
 * MIGRATION_DATABASE_URL to point at it, and run the same command with that
 * environment's emails. Nothing here is specific to the pilot beyond the
 * defaults below, which are all overridable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  clinic: 'shimaa-talal',
  doctor: 'doctor@email.com',
  reception: 'reception@email.com',
};

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

function readArgs() {
  const args = { ...DEFAULTS };
  for (const raw of process.argv.slice(2)) {
    const match = /^--(clinic|doctor|reception)=(.+)$/.exec(raw);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  loadEnv();
  const args = readArgs();

  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Staff linking is an administrative ' +
        'act and uses the owner connection, not the application role.',
    );
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });

  try {
    const clinic = await pool.query(
      'select id, name from clinic.clinics where slug = $1',
      [args.clinic],
    );
    if (clinic.rowCount === 0) {
      throw new Error(
        `No clinic with slug "${args.clinic}". Apply the migrations first.`,
      );
    }
    const { id: clinicId, name } = clinic.rows[0];
    console.log(`Clinic: ${name} (${args.clinic})`);

    const wanted = [
      { email: args.doctor, role: 'doctor', displayName: 'Doctor' },
      { email: args.reception, role: 'reception', displayName: 'Reception' },
    ];

    let linked = 0;
    for (const { email, role, displayName } of wanted) {
      // One statement: resolve the account by email and upsert the membership.
      // Nothing in between, so a concurrent run cannot interleave, and the id
      // never leaves the database.
      const result = await pool.query(
        `insert into clinic.clinic_members
           (clinic_id, auth_user_id, role, display_name)
         select $1, u.id, $2, $3
           from auth.users u
          where u.email = $4
         on conflict (clinic_id, auth_user_id) do update
            set role = excluded.role,
                display_name = excluded.display_name,
                status = 'active'
         returning (xmax = 0) as inserted, role, status`,
        [clinicId, role, displayName, email],
      );

      if (result.rowCount === 0) {
        console.log(
          `  ${email.padEnd(24)} SKIPPED - no such Supabase Auth user. ` +
            'Create the account first, then re-run.',
        );
        continue;
      }

      const { inserted, role: applied, status } = result.rows[0];
      console.log(
        `  ${email.padEnd(24)} ${inserted ? 'linked ' : 'updated'} ` +
          `role=${applied} status=${status}`,
      );
      linked += 1;
    }

    const total = await pool.query(
      'select count(*)::int as n from clinic.clinic_members where clinic_id = $1',
      [clinicId],
    );
    console.log(
      `\n${linked} of ${wanted.length} processed; ` +
        `${total.rows[0].n} member(s) at this clinic.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('bootstrap-staff failed:', error.message);
  process.exitCode = 1;
});

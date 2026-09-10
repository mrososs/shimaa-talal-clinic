import { createClient } from '@supabase/supabase-js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const ROOT = process.cwd();
export const FIXTURE_PATH = resolve(ROOT, 'tmp/dashboard-e2e/fixture.json');
const EMAIL_PATTERN = 'dashboard-e2e-%@example.test';

export interface JourneyUser {
  email: string;
  password: string;
}

export interface DashboardJourneyFixture {
  clinicId: string;
  childId: string;
  childName: string;
  guardianId: string;
  guardianName: string;
  sessionId: string;
  windowStart: string;
  today: string;
  parent: JourneyUser;
  reception: JourneyUser;
  doctor: JourneyUser;
}

export function loadRepoEnv(): void {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

export function readFixture(): DashboardJourneyFixture {
  return JSON.parse(
    readFileSync(FIXTURE_PATH, 'utf8'),
  ) as DashboardJourneyFixture;
}

export function writeFixture(value: DashboardJourneyFixture): void {
  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function removeFixtureFile(): void {
  rmSync(FIXTURE_PATH, { force: true });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the dashboard journey.`);
  return value;
}

export function databaseOptions(): pg.ClientConfig {
  return {
    connectionString: required('MIGRATION_DATABASE_URL'),
    ssl:
      process.env['DATABASE_SSL'] === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  };
}

export function supabaseAdmin() {
  return createClient(
    required('SUPABASE_URL'),
    required('SUPABASE_SECRET_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

/**
 * Remove only rows carrying the dashboard-journey marker. This runs before and
 * after the suite so a killed local run cannot poison the next one.
 */
export async function cleanupDashboardJourney(): Promise<void> {
  loadRepoEnv();
  const database = new pg.Client(databaseOptions());
  const admin = supabaseAdmin();
  await database.connect();

  let authUserIds: string[] = [];
  try {
    authUserIds = (
      await database.query<{ id: string }>(
        `select id from auth.users where email::text like $1`,
        [EMAIL_PATTERN],
      )
    ).rows.map((row) => row.id);

    const children = (
      await database.query<{ id: string }>(
        `select id from clinic.children where full_name like 'E2E Dashboard %'`,
      )
    ).rows.map((row) => row.id);
    const members = (
      await database.query<{ id: string }>(
        `select id from clinic.clinic_members
          where display_name like 'E2E Dashboard %'`,
      )
    ).rows.map((row) => row.id);
    const guardians = (
      await database.query<{ id: string }>(
        `select id from clinic.guardians where full_name like 'E2E Dashboard %'`,
      )
    ).rows.map((row) => row.id);

    await database.query('begin');
    try {
      if (children.length > 0) {
        await database.query(
          `delete from clinic.clinical_encounter_versions where encounter_id in (
             select id from clinic.clinical_encounters where child_id = any($1::uuid[]))`,
          [children],
        );
        await database.query(
          `delete from clinic.clinical_encounters where child_id = any($1::uuid[])`,
          [children],
        );
        await database.query(
          `delete from clinic.clinical_measurements where child_id = any($1::uuid[])`,
          [children],
        );
        await database.query(
          `delete from clinic.payment_events where payment_id in (
             select id from clinic.payments where child_id = any($1::uuid[]))`,
          [children],
        );
        await database.query(
          `delete from clinic.payments where child_id = any($1::uuid[])`,
          [children],
        );
        await database.query(
          `delete from clinic.queue_events where entry_id in (
             select id from clinic.queue_entries where child_id = any($1::uuid[]))`,
          [children],
        );
        await database.query(
          `delete from clinic.queue_entries where child_id = any($1::uuid[])`,
          [children],
        );
        await database.query(
          `delete from clinic.appointment_events where appointment_id in (
             select id from clinic.appointments where child_id = any($1::uuid[]))`,
          [children],
        );
        await database.query(
          `delete from clinic.appointments where child_id = any($1::uuid[])`,
          [children],
        );
        await database.query(
          `delete from clinic.guardian_children where child_id = any($1::uuid[])`,
          [children],
        );
        await database.query(
          `delete from clinic.children where id = any($1::uuid[])`,
          [children],
        );
      }
      if (guardians.length > 0) {
        await database.query(
          `delete from clinic.guardian_claim_codes where guardian_id = any($1::uuid[])`,
          [guardians],
        );
        await database.query(
          `delete from clinic.guardians where id = any($1::uuid[])`,
          [guardians],
        );
      }
      if (members.length > 0) {
        await database.query(
          `delete from clinic.audit_events where actor_member_id = any($1::uuid[])`,
          [members],
        );
        await database.query(
          `delete from clinic.clinic_sessions where doctor_member_id = any($1::uuid[])`,
          [members],
        );
        await database.query(
          `delete from clinic.clinic_members where id = any($1::uuid[])`,
          [members],
        );
      }
      await database.query('commit');
    } catch (error) {
      await database.query('rollback');
      throw error;
    }
  } finally {
    await database.end();
  }

  for (const userId of authUserIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && !/not found/i.test(error.message)) throw error;
  }
}

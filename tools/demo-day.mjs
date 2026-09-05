/**
 * Put a believable half-day into the pilot clinic, and take it out again.
 *
 * For looking at a screen. The queue board is the densest surface in the
 * product — an ordered list, an emergency, somebody who has not arrived yet,
 * three role-dependent button sets — and none of that is visible on an empty
 * clinic. Automated tests prove the rules; this exists so a person can check
 * the layout, the RTL and the polling with their eyes.
 *
 * Everything it creates is tagged with `--tag` and removed by `--down`, so it
 * never becomes data anybody has to reason about later. It touches no existing
 * row: the pilot's own staff accounts are read, never written, and no password
 * is read, printed or needed.
 *
 *   node tools/demo-day.mjs --up      # create a throwaway family and day
 *   node tools/demo-day.mjs --down    # remove everything it created
 *
 * It uses MIGRATION_DATABASE_URL — the owner connection — because seeding is an
 * administrative act, the same reasoning as `bootstrap-staff.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every row this script writes carries it, and `--down` deletes by it. */
const TAG = 'demo';

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

const CHILDREN = [
  { name: `${TAG} لين`, dob: '2022-03-14' },
  { name: `${TAG} يوسف`, dob: '2019-11-02' },
  { name: `${TAG} مريم`, dob: '2025-06-20' },
  { name: `${TAG} آدم`, dob: '2017-01-09' },
];

async function up(client, clinicId) {
  // The day itself, materialised exactly as the API would.
  const session = await client.query(
    `insert into clinic.clinic_sessions (
       clinic_id, doctor_member_id, session_date, session_kind,
       planned_start, planned_end, window_minutes, capacity_per_window,
       avg_consult_minutes, status)
     select distinct on (s.doctor_member_id, s.session_kind)
       s.clinic_id, s.doctor_member_id, d.day, s.session_kind,
       ((d.day + s.starts_at) at time zone c.timezone),
       ((d.day + s.ends_at) at time zone c.timezone),
       s.window_minutes, s.capacity_per_window,
       c.default_avg_consult_minutes, 'open'
     from (select (now() at time zone 'Africa/Cairo')::date as day) d
     join clinic.clinic_schedules s
       on s.clinic_id = $1 and s.active
      and s.weekday = extract(dow from d.day)
      and s.effective_from <= d.day
      and (s.effective_to is null or s.effective_to >= d.day)
     join clinic.clinics c on c.id = s.clinic_id
     order by s.doctor_member_id, s.session_kind, s.effective_from desc
     on conflict (clinic_id, doctor_member_id, session_date, session_kind)
     do update set status = 'open'
     returning id, planned_start, window_minutes`,
    [clinicId],
  );
  if (session.rowCount === 0) {
    throw new Error('The clinic runs no session today, so there is nothing to show.');
  }
  const { id: sessionId, window_minutes: windowMinutes } = session.rows[0];

  const guardian = await client.query(
    `insert into clinic.guardians (clinic_id, full_name, phone_e164)
     values ($1, $2, '+201555000001')
     on conflict (clinic_id, phone_e164) do update set full_name = excluded.full_name
     returning id`,
    [clinicId, `${TAG} أم لين`],
  );
  const guardianId = guardian.rows[0].id;

  const childIds = [];
  for (const child of CHILDREN) {
    const row = await client.query(
      `insert into clinic.children (clinic_id, full_name, date_of_birth)
       values ($1, $2, $3::date) returning id`,
      [clinicId, child.name, child.dob],
    );
    childIds.push(row.rows[0].id);
    await client.query(
      `insert into clinic.guardian_children (guardian_id, child_id, relationship)
       values ($1, $2, 'mother') on conflict do nothing`,
      [guardianId, row.rows[0].id],
    );
  }

  // Two arrivals and two families still expected — one of them already late,
  // which is the state the board derives rather than stores.
  const windows = [-2, -1, 0, 1];
  for (const [index, childId] of childIds.entries()) {
    await client.query(
      `insert into clinic.appointments
         (clinic_id, session_id, child_id, guardian_id,
          window_start, window_end, seat_no, visit_type, status)
       values ($1, $2, $3, $4,
               date_trunc('hour', now())
                 + make_interval(mins => $5::int * $6::int),
               date_trunc('hour', now())
                 + make_interval(mins => ($5::int + 1) * $6::int),
               $7, 'new_visit', 'confirmed')`,
      [
        clinicId,
        sessionId,
        childId,
        guardianId,
        windows[index],
        windowMinutes,
        index + 1,
      ],
    );
  }

  console.log(`Seeded ${childIds.length} families into today's session.`);
  console.log('Remove them with: node tools/demo-day.mjs --down');
}

async function down(client, clinicId) {
  const children = await client.query(
    `select id from clinic.children where clinic_id = $1 and full_name like $2`,
    [clinicId, `${TAG} %`],
  );
  const childIds = children.rows.map((row) => row.id);

  await client.query(
    `delete from clinic.queue_events where entry_id in (
       select id from clinic.queue_entries where child_id = any($1))`,
    [childIds],
  );
  await client.query(`delete from clinic.queue_entries where child_id = any($1)`, [
    childIds,
  ]);
  await client.query(
    `delete from clinic.appointment_events where appointment_id in (
       select id from clinic.appointments where child_id = any($1))`,
    [childIds],
  );
  await client.query(`delete from clinic.appointments where child_id = any($1)`, [
    childIds,
  ]);
  await client.query(
    `delete from clinic.guardian_children where child_id = any($1)`,
    [childIds],
  );
  await client.query(`delete from clinic.children where id = any($1)`, [childIds]);
  await client.query(
    `delete from clinic.guardians where clinic_id = $1 and full_name like $2`,
    [clinicId, `${TAG} %`],
  );
  // Today's session goes too, but only if nothing real is left in it. It was
  // materialised for the demo and the API re-creates it on demand, so removing
  // it puts the clinic back to the state it was in — including the ticket
  // counter, which the demo advanced.
  const removed = await client.query(
    `delete from clinic.clinic_sessions s
      where s.clinic_id = $1
        and s.session_date = (now() at time zone 'Africa/Cairo')::date
        and not exists (
          select 1 from clinic.queue_entries q where q.session_id = s.id)
        and not exists (
          select 1 from clinic.appointments a where a.session_id = s.id)`,
    [clinicId],
  );
  console.log(
    `Removed ${childIds.length} demo families` +
      (removed.rowCount > 0 ? " and today's empty session." : '.'),
  );
}

async function main() {
  loadEnv();
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set.');

  const direction = process.argv.includes('--down') ? down : up;

  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const clinic = await client.query(
      `select id from clinic.clinics where slug = $1`,
      [process.env.CLINIC_SLUG ?? 'shimaa-talal'],
    );
    if (clinic.rowCount === 0) throw new Error('No such clinic.');
    await direction(client, clinic.rows[0].id);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

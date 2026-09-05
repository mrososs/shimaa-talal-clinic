import {
  createTestDatabase,
  testDatabaseUrl,
  type SqlExecutor,
  type TestDatabase,
} from '@clinic/server-core';

/**
 * A clinic with an open session and a few children to put in the queue.
 *
 * The session is created directly rather than materialised from a schedule:
 * this suite is about the queue, and a session made here can be opened,
 * paused or closed exactly when a case needs it.
 */
export interface QueueFixture {
  readonly db: TestDatabase;
  readonly clinicId: string;
  readonly otherClinicId: string;
  readonly doctorMemberId: string;
  readonly otherDoctorMemberId: string;
  readonly guardianId: string;
}

const SUITE_TAG = `queue-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const STAFF_EMAIL = 'doctor@email.com';

export function describeWithDatabase(
  name: string,
  suite: (fixture: QueueFixture) => void,
): void {
  const url = testDatabaseUrl();

  if (url === null) {
    describe.skip(`${name} (no MIGRATION_DATABASE_URL configured)`, () => {
      it('is skipped', () => undefined);
    });
    return;
  }

  describe(name, () => {
    const fixture = {} as {
      -readonly [K in keyof QueueFixture]: QueueFixture[K];
    };

    beforeAll(async () => {
      fixture.db = createTestDatabase(url);
      const sql = fixture.db.database;

      await sweepStaleFixtures(sql);

      const staff = await sql.query<{ id: string }>(
        `select id from auth.users where email = $1 limit 1`,
        [STAFF_EMAIL],
      );
      if (staff.rows[0] === undefined) {
        throw new Error(
          `Expected an auth user ${STAFF_EMAIL} to exist for the fixture.`,
        );
      }
      const authUserId = staff.rows[0].id;

      fixture.clinicId = await insertClinic(sql, `${SUITE_TAG}-a`);
      fixture.otherClinicId = await insertClinic(sql, `${SUITE_TAG}-b`);
      fixture.doctorMemberId = await insertDoctor(
        sql,
        fixture.clinicId,
        authUserId,
      );
      fixture.otherDoctorMemberId = await insertDoctor(
        sql,
        fixture.otherClinicId,
        authUserId,
      );

      const guardian = await sql.query<{ id: string }>(
        `insert into clinic.guardians (clinic_id, full_name, phone_e164)
         values ($1, 'Queue Guardian', $2) returning id`,
        [fixture.clinicId, `+2010${String(Date.now()).slice(-7)}`],
      );
      fixture.guardianId = guardian.rows[0].id;
    }, 60_000);

    afterAll(async () => {
      if (fixture.db === undefined) return;
      await removeClinics(fixture.db.database, [
        fixture.clinicId,
        fixture.otherClinicId,
      ]);
      await fixture.db.close();
    }, 60_000);

    suite(fixture as QueueFixture);
  });
}

/** A session, open by default — most cases need a queue that is running. */
export async function insertSession(
  sql: SqlExecutor,
  input: {
    clinicId: string;
    doctorMemberId: string;
    status?: 'scheduled' | 'open' | 'paused' | 'closed';
    /** One session per doctor per day per kind — a second one needs the other. */
    kind?: 'morning' | 'evening';
  },
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinic_sessions
       (clinic_id, doctor_member_id, session_date, session_kind,
        planned_start, planned_end, window_minutes, capacity_per_window,
        avg_consult_minutes, status)
     values ($1, $2,
             (now() at time zone 'Africa/Cairo')::date, $4,
             now(), now() + interval '6 hours', 60, 5, 6, $3)
     returning id`,
    [
      input.clinicId,
      input.doctorMemberId,
      input.status ?? 'open',
      input.kind ?? 'morning',
    ],
  );
  return result.rows[0].id;
}

export async function insertChild(
  sql: SqlExecutor,
  clinicId: string,
  name: string,
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.children (clinic_id, full_name) values ($1, $2)
     returning id`,
    [clinicId, name],
  );
  return result.rows[0].id;
}

async function insertClinic(sql: SqlExecutor, slug: string): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinics
       (name, slug, timezone, default_country_code, grace_period_minutes,
        max_self_defers)
     values ($1, $2, 'Africa/Cairo', 'EG', 10, 2)
     returning id`,
    [`Fixture ${slug}`, slug],
  );
  return result.rows[0].id;
}

async function insertDoctor(
  sql: SqlExecutor,
  clinicId: string,
  authUserId: string,
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinic_members
       (clinic_id, auth_user_id, role, display_name)
     values ($1, $2, 'doctor', 'Fixture Doctor')
     returning id`,
    [clinicId, authUserId],
  );
  return result.rows[0].id;
}

/** See the other fixtures: a killed run leaves rows behind. */
async function sweepStaleFixtures(sql: SqlExecutor): Promise<void> {
  const stale = await sql.query<{ id: string }>(
    `select id from clinic.clinics
      where slug like 'queue-%'
        and name like 'Fixture %'
        and created_at < now() - interval '1 hour'`,
  );
  if (stale.rows.length === 0) return;
  await removeClinics(
    sql,
    stale.rows.map((row) => row.id),
  );
}

async function removeClinics(
  sql: SqlExecutor,
  clinicIds: string[],
): Promise<void> {
  await sql.query(
    `delete from clinic.queue_events
      where entry_id in (
        select id from clinic.queue_entries where clinic_id = any($1))`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.queue_entries where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.appointment_events
      where appointment_id in (
        select id from clinic.appointments where clinic_id = any($1))`,
    [clinicIds],
  );
  await sql.query(`delete from clinic.appointments where clinic_id = any($1)`, [
    clinicIds,
  ]);
  await sql.query(
    `delete from clinic.clinic_sessions where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.guardian_children
      where child_id in (select id from clinic.children where clinic_id = any($1))`,
    [clinicIds],
  );
  await sql.query(`delete from clinic.children where clinic_id = any($1)`, [
    clinicIds,
  ]);
  await sql.query(`delete from clinic.guardians where clinic_id = any($1)`, [
    clinicIds,
  ]);
  await sql.query(
    `delete from clinic.clinic_members where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(`delete from clinic.clinics where id = any($1)`, [clinicIds]);
}

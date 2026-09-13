import {
  createTestDatabase,
  testDatabaseUrl,
  type SqlExecutor,
  type TestDatabase,
} from '@clinic/server-core';

/**
 * A disposable clinic, with a doctor, to run a suite inside.
 *
 * Sessions hang off a clinic and a doctor member, and everything this library
 * does is scoped by `clinic_id` — so a suite needs a real tenant, and a second
 * one to prove the scoping holds. Both are removed afterwards.
 *
 * The timezone is a parameter rather than a constant because the day boundary
 * is the thing most likely to be wrong: a suite that only ever runs in Cairo
 * cannot tell a correct implementation from one that quietly uses the server's
 * clock.
 */
export interface ClinicFixture {
  readonly db: TestDatabase;
  readonly clinicId: string;
  readonly otherClinicId: string;
  readonly doctorMemberId: string;
  /** The second clinic's doctor, for cross-tenant assertions. */
  readonly otherDoctorMemberId: string;
  /** A clinic in Kiritimati (UTC+14), for day-boundary assertions. */
  readonly farEastClinicId: string;
  readonly farEastDoctorMemberId: string;
}

const SUITE_TAG = `clinic-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

/**
 * Staff auth users already exist in this project; the fixture borrows one so
 * the NOT NULL foreign key on `clinic_members.auth_user_id` is satisfied
 * without creating auth users, which is not this library's business.
 *
 * Resolved by email rather than by a hardcoded uuid: an id belongs to one
 * environment, and a test carrying one only runs in that environment.
 */
const STAFF_EMAIL = 'doctor@email.com';

export function describeWithDatabase(
  name: string,
  suite: (fixture: ClinicFixture) => void,
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
      -readonly [K in keyof ClinicFixture]: ClinicFixture[K];
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
      // UTC+14: the furthest a calendar day can be from UTC, so a session date
      // computed from the server's clock is visibly wrong here for ten hours a
      // day.
      fixture.farEastClinicId = await insertClinic(
        sql,
        `${SUITE_TAG}-c`,
        'Pacific/Kiritimati',
      );

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
      fixture.farEastDoctorMemberId = await insertDoctor(
        sql,
        fixture.farEastClinicId,
        authUserId,
      );
    }, 60_000);

    afterAll(async () => {
      if (fixture.db === undefined) return;
      await removeClinics(fixture.db.database, [
        fixture.clinicId,
        fixture.otherClinicId,
        fixture.farEastClinicId,
      ]);
      await fixture.db.close();
    }, 60_000);

    suite(fixture as ClinicFixture);
  });
}

/**
 * Remove fixture clinics an earlier run failed to clean up.
 *
 * `afterAll` normally handles it, but a run killed mid-test never gets there,
 * and the rows it leaves behind are invisible until some unrelated suite counts
 * clinic members and finds too many. An hour is far longer than any suite runs,
 * so this can never touch a concurrent one — and it will never touch a real
 * clinic, whose slug does not look like this.
 */
async function sweepStaleFixtures(sql: SqlExecutor): Promise<void> {
  const stale = await sql.query<{ id: string }>(
    `select id from clinic.clinics
      where slug like 'clinic-%'
        and name like 'Fixture %'
        and created_at < now() - interval '1 hour'`,
  );
  if (stale.rows.length === 0) return;

  await removeClinics(
    sql,
    stale.rows.map((row) => row.id),
  );
}

async function insertClinic(
  sql: SqlExecutor,
  slug: string,
  timezone = 'Africa/Cairo',
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinics
       (name, slug, timezone, default_country_code, default_avg_consult_minutes)
     values ($1, $2, $3, 'EG', 6)
     returning id`,
    [`Fixture ${slug}`, slug, timezone],
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

/**
 * Foreign keys are RESTRICT rather than CASCADE, deliberately, so teardown
 * removes rows in dependency order rather than relying on a cascade.
 */
async function removeClinics(
  sql: SqlExecutor,
  clinicIds: string[],
): Promise<void> {
  await sql.query(`delete from clinic.audit_events where clinic_id = any($1)`, [
    clinicIds,
  ]);
  await sql.query(
    `delete from clinic.clinic_sessions where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.clinic_closures where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.clinic_schedules where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.clinic_members where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(`delete from clinic.clinics where id = any($1)`, [clinicIds]);
}

/**
 * Insert a weekly schedule row.
 *
 * `effective_from` defaults to the distant past so a schedule applies to every
 * date a test might pick, including yesterday.
 */
export async function insertSchedule(
  sql: SqlExecutor,
  input: {
    clinicId: string;
    doctorMemberId: string;
    weekday: number;
    sessionKind?: 'morning' | 'evening';
    startsAt?: string;
    endsAt?: string;
    windowMinutes?: number;
    capacityPerWindow?: number;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    active?: boolean;
  },
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinic_schedules
       (clinic_id, doctor_member_id, weekday, session_kind, starts_at, ends_at,
        window_minutes, capacity_per_window, effective_from, effective_to, active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      input.clinicId,
      input.doctorMemberId,
      input.weekday,
      input.sessionKind ?? 'morning',
      input.startsAt ?? '10:00',
      input.endsAt ?? '16:00',
      input.windowMinutes ?? 60,
      input.capacityPerWindow ?? 5,
      input.effectiveFrom ?? '2000-01-01',
      input.effectiveTo ?? null,
      input.active ?? true,
    ],
  );
  return result.rows[0].id;
}

/** Postgres' own weekday numbering for an ISO date, computed by Postgres. */
export async function weekdayOf(
  sql: SqlExecutor,
  date: string,
): Promise<number> {
  const result = await sql.query<{ dow: string }>(
    `select extract(dow from $1::date)::text as dow`,
    [date],
  );
  return Number(result.rows[0].dow);
}

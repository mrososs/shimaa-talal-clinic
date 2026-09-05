import {
  createTestDatabase,
  testDatabaseUrl,
  type SqlExecutor,
  type TestDatabase,
} from '@clinic/server-core';

/**
 * A clinic that is open today, with a family to book.
 *
 * Everything Booking does needs a session to book into and a child to book, so
 * the fixture builds a whole clinic: tenant, doctor, schedule, guardian, two
 * children — plus a second tenant, to prove scoping holds.
 *
 * The session is created directly rather than materialised from a schedule.
 * Booking's job is not to test materialisation (the clinic library does that),
 * and a session built here can be given exactly the window size and capacity a
 * case needs.
 */
export interface BookingFixture {
  readonly db: TestDatabase;
  readonly clinicId: string;
  readonly otherClinicId: string;
  readonly doctorMemberId: string;
  readonly otherDoctorMemberId: string;
  readonly guardianId: string;
  readonly otherGuardianId: string;
  readonly childId: string;
  readonly siblingId: string;
}

const SUITE_TAG = `booking-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

const STAFF_EMAIL = 'doctor@email.com';

export function describeWithDatabase(
  name: string,
  suite: (fixture: BookingFixture) => void,
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
      -readonly [K in keyof BookingFixture]: BookingFixture[K];
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

      fixture.guardianId = await insertGuardian(sql, fixture.clinicId, '1');
      fixture.otherGuardianId = await insertGuardian(
        sql,
        fixture.otherClinicId,
        '2',
      );
      fixture.childId = await insertChild(sql, fixture.clinicId, 'Leen');
      fixture.siblingId = await insertChild(sql, fixture.clinicId, 'Yusuf');
    }, 60_000);

    afterAll(async () => {
      if (fixture.db === undefined) return;
      await removeClinics(fixture.db.database, [
        fixture.clinicId,
        fixture.otherClinicId,
      ]);
      await fixture.db.close();
    }, 60_000);

    suite(fixture as BookingFixture);
  });
}

/**
 * A session, with the shape a case needs.
 *
 * Defaults to a window starting an hour from now, so it is bookable: a session
 * in the past would be refused by the clinic's booking cutoff and every test
 * would be asserting the wrong rule.
 */
export async function insertSession(
  sql: SqlExecutor,
  input: {
    clinicId: string;
    doctorMemberId: string;
    startsInMinutes?: number;
    lengthMinutes?: number;
    windowMinutes?: number;
    capacityPerWindow?: number;
    status?: 'scheduled' | 'open' | 'paused' | 'closed';
  },
): Promise<{ id: string; windowStart: string }> {
  const startsIn = input.startsInMinutes ?? 60;
  const length = input.lengthMinutes ?? 180;

  const result = await sql.query<{ id: string; planned_start: Date }>(
    `insert into clinic.clinic_sessions
       (clinic_id, doctor_member_id, session_date, session_kind,
        planned_start, planned_end, window_minutes, capacity_per_window,
        avg_consult_minutes, status)
     values (
       $1, $2,
       ((now() + make_interval(mins => $3)) at time zone 'Africa/Cairo')::date,
       'morning',
       -- Truncated to the minute so the window boundary is an exact instant;
       -- the booking check requires the offset to divide evenly.
       date_trunc('minute', now() + make_interval(mins => $3)),
       date_trunc('minute', now() + make_interval(mins => $3 + $4)),
       $5, $6, 6, $7)
     returning id, planned_start`,
    [
      input.clinicId,
      input.doctorMemberId,
      startsIn,
      length,
      input.windowMinutes ?? 60,
      input.capacityPerWindow ?? 5,
      input.status ?? 'scheduled',
    ],
  );

  return {
    id: result.rows[0].id,
    windowStart: result.rows[0].planned_start.toISOString(),
  };
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

async function insertGuardian(
  sql: SqlExecutor,
  clinicId: string,
  suffix: string,
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.guardians (clinic_id, full_name, phone_e164)
     values ($1, 'Fixture Guardian', $2) returning id`,
    [clinicId, `+2010${String(Date.now()).slice(-7)}${suffix}`],
  );
  return result.rows[0].id;
}

async function insertClinic(sql: SqlExecutor, slug: string): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinics
       (name, slug, timezone, default_country_code, default_avg_consult_minutes)
     values ($1, $2, 'Africa/Cairo', 'EG', 6)
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

/** See the clinic library's fixture: a killed run leaves rows behind. */
async function sweepStaleFixtures(sql: SqlExecutor): Promise<void> {
  const stale = await sql.query<{ id: string }>(
    `select id from clinic.clinics
      where slug like 'booking-%'
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
    `delete from clinic.appointment_events
      where appointment_id in (
        select id from clinic.appointments where clinic_id = any($1))`,
    [clinicIds],
  );
  await sql.query(
    `update clinic.appointments set rescheduled_from_appointment_id = null
      where clinic_id = any($1)`,
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
    `delete from clinic.clinic_closures where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.clinic_schedules where clinic_id = any($1)`,
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

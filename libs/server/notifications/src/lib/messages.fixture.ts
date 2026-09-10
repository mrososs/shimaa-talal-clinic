import {
  createTestDatabase,
  testDatabaseUrl,
  type SqlExecutor,
  type TestDatabase,
} from '@clinic/server-core';

/**
 * A clinic with a desk, a doctor, and one family to talk to.
 *
 * The inbox is almost entirely SQL — unread is a join against a read marker,
 * idempotency is a unique index, and "already decided" is a `where` clause.
 * None of that can be proven against a mocked executor, so this suite talks to
 * a real server like the other domain suites do.
 */
export interface MessagesFixture {
  readonly db: TestDatabase;
  readonly clinicId: string;
  readonly otherClinicId: string;
  readonly doctorMemberId: string;
  readonly receptionMemberId: string;
  readonly otherClinicMemberId: string;
  readonly guardianId: string;
  readonly childId: string;
}

const SUITE_TAG = `messages-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

/**
 * Two accounts, because `clinic_members_clinic_user_uq` allows one membership
 * per account per clinic — and this suite needs a desk and a doctor in the
 * same clinic to test who may decide an urgent case.
 */
const DOCTOR_EMAIL = 'doctor@email.com';
const RECEPTION_EMAIL = 'reception@email.com';

export function describeWithDatabase(
  name: string,
  suite: (fixture: MessagesFixture) => void,
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
      -readonly [K in keyof MessagesFixture]: MessagesFixture[K];
    };

    beforeAll(async () => {
      fixture.db = createTestDatabase(url);
      const sql = fixture.db.database;

      await sweepStaleFixtures(sql);

      const doctorAuthId = await authUser(sql, DOCTOR_EMAIL);
      const receptionAuthId = await authUser(sql, RECEPTION_EMAIL);

      fixture.clinicId = await insertClinic(sql, `${SUITE_TAG}-a`);
      fixture.otherClinicId = await insertClinic(sql, `${SUITE_TAG}-b`);
      fixture.doctorMemberId = await insertMember(
        sql,
        fixture.clinicId,
        doctorAuthId,
        'doctor',
      );
      fixture.receptionMemberId = await insertMember(
        sql,
        fixture.clinicId,
        receptionAuthId,
        'reception',
      );
      // The doctor account also sits in the second clinic. Safe here only
      // because every call in this suite is given its `clinicId` explicitly and
      // nothing resolves a member by auth id — see the warning in CLAUDE.md.
      fixture.otherClinicMemberId = await insertMember(
        sql,
        fixture.otherClinicId,
        doctorAuthId,
        'doctor',
      );

      const guardian = await sql.query<{ id: string }>(
        `insert into clinic.guardians (clinic_id, full_name, phone_e164)
         values ($1, 'Messages Guardian', $2) returning id`,
        [fixture.clinicId, `+2010${String(Date.now()).slice(-7)}`],
      );
      fixture.guardianId = guardian.rows[0].id;

      const child = await sql.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name)
         values ($1, 'Messages Child') returning id`,
        [fixture.clinicId],
      );
      fixture.childId = child.rows[0].id;

      // No `clinic_id` here: the link is tenant-scoped through both of its
      // parents, which are already in one clinic.
      await sql.query(
        `insert into clinic.guardian_children (guardian_id, child_id, relationship)
         values ($1, $2, 'mother')`,
        [fixture.guardianId, fixture.childId],
      );

      await sql.query(
        `insert into clinic.quick_reply_templates (clinic_id, title, body, sort_order)
         values ($1, 'تعليمات الخافض', 'الجرعة كل ٦ ساعات مع متابعة الحرارة.', 1),
                ($1, 'موعد المتابعة', 'نتابع بعد ٤٨ ساعة إن استمرت الأعراض.', 2)`,
        [fixture.clinicId],
      );
    }, 60_000);

    afterAll(async () => {
      if (fixture.db === undefined) return;
      await removeClinics(fixture.db.database, [
        fixture.clinicId,
        fixture.otherClinicId,
      ]);
      await fixture.db.close();
    }, 60_000);

    suite(fixture as MessagesFixture);
  });
}

/**
 * A message from the family.
 *
 * Written directly rather than through a service, because the parent side of
 * the inbox has no API yet — the dashboard is the only client D6 ships. Unread
 * counting is defined against guardian-sent rows, so a suite that could only
 * produce staff replies could not test it at all.
 */
export async function insertGuardianMessage(
  sql: SqlExecutor,
  input: {
    clinicId: string;
    threadId: string;
    guardianId: string;
    body: string;
  },
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.thread_messages
       (clinic_id, thread_id, sender_guardian_id, body)
     values ($1, $2, $3, $4) returning id`,
    [input.clinicId, input.threadId, input.guardianId, input.body],
  );
  await sql.query(
    `update clinic.message_threads set last_message_at = now() where id = $1`,
    [input.threadId],
  );
  return result.rows[0].id;
}

/** Everything one suite's threads leave behind, in foreign-key order. */
export async function clearThreads(
  sql: SqlExecutor,
  clinicIds: string[],
): Promise<void> {
  await sql.query(
    `delete from clinic.message_events where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.thread_messages where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.message_thread_reads where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(`delete from clinic.urgent_cases where clinic_id = any($1)`, [
    clinicIds,
  ]);
  await sql.query(
    `delete from clinic.notification_outbox where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.message_threads where clinic_id = any($1)`,
    [clinicIds],
  );
}

async function authUser(sql: SqlExecutor, email: string): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `select id from auth.users where email = $1 limit 1`,
    [email],
  );
  if (result.rows[0] === undefined) {
    throw new Error(`Expected an auth user ${email} to exist for the fixture.`);
  }
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

async function insertMember(
  sql: SqlExecutor,
  clinicId: string,
  authUserId: string,
  role: 'doctor' | 'reception',
): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinic_members
       (clinic_id, auth_user_id, role, display_name)
     values ($1, $2, $3, $4)
     returning id`,
    [clinicId, authUserId, role, role === 'doctor' ? 'د. شيماء' : 'مساعدة'],
  );
  return result.rows[0].id;
}

/** See the other fixtures: a killed run leaves rows behind. */
async function sweepStaleFixtures(sql: SqlExecutor): Promise<void> {
  const stale = await sql.query<{ id: string }>(
    `select id from clinic.clinics
      where slug like 'messages-%'
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
  await clearThreads(sql, clinicIds);
  await sql.query(
    `delete from clinic.quick_reply_templates where clinic_id = any($1)`,
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

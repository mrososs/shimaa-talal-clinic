import {
  createTestDatabase,
  testDatabaseUrl,
  type SqlExecutor,
  type TestDatabase,
} from '@clinic/server-core';

export interface PaymentsFixture {
  readonly db: TestDatabase;
  readonly clinicId: string;
  readonly doctorMemberId: string;
  readonly guardianId: string;
  readonly otherGuardianId: string;
  readonly childId: string;
  readonly appointmentId: string;
}

const TAG = `payments-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

export function describePaymentsWithDatabase(
  suite: (fixture: PaymentsFixture) => void,
): void {
  const url = testDatabaseUrl();
  if (url === null) {
    describe.skip('parent payments (no MIGRATION_DATABASE_URL configured)', () => {
      it('is skipped', () => undefined);
    });
    return;
  }

  describe('parent payments', () => {
    const fixture = {} as {
      -readonly [K in keyof PaymentsFixture]: PaymentsFixture[K];
    };

    beforeAll(async () => {
      fixture.db = createTestDatabase(url);
      const sql = fixture.db.database;
      await sweep(sql);

      const auth = await sql.query<{ id: string }>(
        `select id from auth.users where email = 'doctor@email.com' limit 1`,
      );
      if (!auth.rows[0]) throw new Error('Demo doctor auth user is required.');

      const clinic = await sql.query<{ id: string }>(
        `insert into clinic.clinics
          (name, slug, timezone, default_country_code, grace_period_minutes,
           max_self_defers)
         values ('Payments fixture', $1, 'Africa/Cairo', 'EG', 10, 2)
         returning id`,
        [TAG],
      );
      fixture.clinicId = clinic.rows[0].id;

      const member = await sql.query<{ id: string }>(
        `insert into clinic.clinic_members
          (clinic_id, auth_user_id, role, display_name)
         values ($1, $2, 'doctor', 'Payments Doctor') returning id`,
        [fixture.clinicId, auth.rows[0].id],
      );
      fixture.doctorMemberId = member.rows[0].id;

      const guardians = await sql.query<{ id: string }>(
        `insert into clinic.guardians (clinic_id, full_name, phone_e164)
         values ($1, 'Payment Guardian', $2),
                ($1, 'Other Guardian', $3)
         returning id`,
        [
          fixture.clinicId,
          `+2011${String(Date.now()).slice(-7)}`,
          `+2012${String(Date.now() + 1).slice(-7)}`,
        ],
      );
      fixture.guardianId = guardians.rows[0].id;
      fixture.otherGuardianId = guardians.rows[1].id;

      const child = await sql.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name)
         values ($1, 'Payment Child') returning id`,
        [fixture.clinicId],
      );
      fixture.childId = child.rows[0].id;
      await sql.query(
        `insert into clinic.guardian_children
          (guardian_id, child_id, relationship)
         values ($1, $2, 'mother')`,
        [fixture.guardianId, fixture.childId],
      );

      const session = await sql.query<{ id: string }>(
        `insert into clinic.clinic_sessions
          (clinic_id, doctor_member_id, session_date, session_kind,
           planned_start, planned_end, window_minutes, capacity_per_window,
           avg_consult_minutes)
         values ($1, $2, current_date + 7, 'morning',
                 now() + interval '7 days', now() + interval '7 days 4 hours',
                 30, 4, 15)
         returning id`,
        [fixture.clinicId, fixture.doctorMemberId],
      );

      await sql.query(
        `insert into clinic.service_prices
          (clinic_id, visit_type, amount_minor, currency)
         values ($1, 'new_visit', 45000, 'EGP')`,
        [fixture.clinicId],
      );
      const appointment = await sql.query<{ id: string }>(
        `insert into clinic.appointments
          (clinic_id, session_id, child_id, guardian_id, window_start,
           window_end, seat_no, visit_type, status)
         values ($1, $2, $3, $4, now() + interval '7 days',
                 now() + interval '7 days 30 minutes', 1, 'new_visit',
                 'confirmed')
         returning id`,
        [
          fixture.clinicId,
          session.rows[0].id,
          fixture.childId,
          fixture.guardianId,
        ],
      );
      fixture.appointmentId = appointment.rows[0].id;
    }, 60_000);

    afterAll(async () => {
      if (!fixture.db) return;
      await removeClinics(fixture.db.database, [fixture.clinicId]);
      await fixture.db.close();
    }, 60_000);

    suite(fixture as PaymentsFixture);
  });
}

export async function clearPayments(
  sql: SqlExecutor,
  clinicId: string,
): Promise<void> {
  await sql.query(`delete from clinic.payment_events where clinic_id = $1`, [
    clinicId,
  ]);
  await sql.query(`delete from clinic.payments where clinic_id = $1`, [clinicId]);
}

async function sweep(sql: SqlExecutor): Promise<void> {
  const stale = await sql.query<{ id: string }>(
    `select id from clinic.clinics
      where slug like 'payments-%' and name = 'Payments fixture'
        and created_at < now() - interval '1 hour'`,
  );
  await removeClinics(
    sql,
    stale.rows.map((row) => row.id),
  );
}

async function removeClinics(
  sql: SqlExecutor,
  clinicIds: string[],
): Promise<void> {
  if (clinicIds.length === 0) return;
  await sql.query(`delete from clinic.payment_events where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.payments where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.appointment_events where appointment_id in (select id from clinic.appointments where clinic_id = any($1))`, [clinicIds]);
  await sql.query(`delete from clinic.appointments where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.service_prices where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.clinic_sessions where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.guardian_children where child_id in (select id from clinic.children where clinic_id = any($1))`, [clinicIds]);
  await sql.query(`delete from clinic.children where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.guardians where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.clinic_members where clinic_id = any($1)`, [clinicIds]);
  await sql.query(`delete from clinic.clinics where id = any($1)`, [clinicIds]);
}

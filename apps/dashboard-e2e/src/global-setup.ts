import pg from 'pg';
import {
  cleanupDashboardJourney,
  databaseOptions,
  loadRepoEnv,
  supabaseAdmin,
  writeFixture,
  type DashboardJourneyFixture,
} from './fixture.js';

export default async function globalSetup(): Promise<void> {
  loadRepoEnv();
  await cleanupDashboardJourney();

  const database = new pg.Client(databaseOptions());
  const admin = supabaseAdmin();
  await database.connect();

  const tag = crypto.randomUUID();
  const password = `Clinic-E2E-${tag}-Aa1!`;
  const users = {
    doctor: { email: `dashboard-e2e-doctor-${tag}@example.test`, password },
    reception: {
      email: `dashboard-e2e-reception-${tag}@example.test`,
      password,
    },
    parent: { email: `dashboard-e2e-parent-${tag}@example.test`, password },
  };
  const createdUserIds: string[] = [];

  try {
    const clinic = (
      await database.query<{
        id: string;
        today: string;
        min_lead_minutes: number;
      }>(
        `select id,
                (now() at time zone timezone)::date::text as today,
                min_lead_minutes
           from clinic.clinics
          where slug = $1`,
        [process.env['CLINIC_SLUG'] ?? 'shimaa-talal'],
      )
    ).rows[0];
    if (!clinic) throw new Error('The pilot clinic was not found.');

    const authIds: Record<keyof typeof users, string> = {
      doctor: '',
      reception: '',
      parent: '',
    };
    for (const [role, user] of Object.entries(users) as [
      keyof typeof users,
      (typeof users)[keyof typeof users],
    ][]) {
      const created = await admin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { full_name: `E2E Dashboard ${role}` },
        app_metadata: { fixture: 'dashboard-e2e' },
      });
      if (created.error) throw created.error;
      authIds[role] = created.data.user.id;
      createdUserIds.push(created.data.user.id);
    }

    await database.query('begin');
    try {
      const doctorMember = (
        await database.query<{ id: string }>(
          `insert into clinic.clinic_members
             (clinic_id, auth_user_id, role, display_name, status)
           values ($1, $2, 'doctor', 'E2E Dashboard Doctor', 'active')
           returning id`,
          [clinic.id, authIds.doctor],
        )
      ).rows[0];
      await database.query(
        `insert into clinic.clinic_members
           (clinic_id, auth_user_id, role, display_name, status)
         values ($1, $2, 'reception', 'E2E Dashboard Reception', 'active')`,
        [clinic.id, authIds.reception],
      );

      const guardianName = 'E2E Dashboard ولي الأمر';
      const guardian = (
        await database.query<{ id: string }>(
          `insert into clinic.guardians
             (clinic_id, auth_user_id, full_name, phone_e164, email,
              default_relationship, claimed_at, claimed_via)
           values ($1, $2, $3, $4, $5, 'mother', now(), 'self_signup')
           returning id`,
          [
            clinic.id,
            authIds.parent,
            guardianName,
            `+2015${Date.now().toString().slice(-9)}`,
            users.parent.email,
          ],
        )
      ).rows[0];
      const childName = 'E2E Dashboard طفل الرحلة';
      const child = (
        await database.query<{ id: string }>(
          `insert into clinic.children
             (clinic_id, full_name, date_of_birth, sex)
           values ($1, $2, date '2021-04-12', 'female')
           returning id`,
          [clinic.id, childName],
        )
      ).rows[0];
      await database.query(
        `insert into clinic.guardian_children
           (guardian_id, child_id, relationship, is_primary)
         values ($1, $2, 'mother', true)`,
        [guardian.id, child.id],
      );

      const session = (
        await database.query<{ id: string; planned_start: Date }>(
          `insert into clinic.clinic_sessions
             (clinic_id, doctor_member_id, session_date, session_kind,
              planned_start, planned_end, window_minutes, capacity_per_window,
              status, doctor_presence, avg_consult_minutes, opened_at)
           values (
             $1, $2, $3::date, 'evening',
             date_trunc('minute', now()) + make_interval(mins => $4),
             date_trunc('minute', now()) + make_interval(mins => $4 + 60),
             60, 5, 'open', 'arrived', 6, now()
           )
           returning id, planned_start`,
          [
            clinic.id,
            doctorMember.id,
            clinic.today,
            clinic.min_lead_minutes + 5,
          ],
        )
      ).rows[0];

      const fixture: DashboardJourneyFixture = {
        clinicId: clinic.id,
        childId: child.id,
        childName,
        guardianId: guardian.id,
        guardianName,
        sessionId: session.id,
        windowStart: session.planned_start.toISOString(),
        today: clinic.today,
        ...users,
      };
      writeFixture(fixture);
      await database.query('commit');
    } catch (error) {
      await database.query('rollback');
      throw error;
    }
  } catch (error) {
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
    throw error;
  } finally {
    await database.end();
  }
}

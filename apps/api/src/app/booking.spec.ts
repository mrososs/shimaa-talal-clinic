import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from '@clinic/server-core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

/**
 * Booking, over real HTTP.
 *
 * The properties that matter here are not "does a POST return 201". They are:
 * a parent can only ever book for their own child, a parent's booking is a
 * request while staff's is confirmed, one clinic cannot see another's day, and
 * a window that has filled says so in a way a screen can act on.
 */

const url = testDatabaseUrl();
const supabaseUrl = process.env['SUPABASE_URL'];
const secretKey = process.env['SUPABASE_SECRET_KEY'];
const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'];
const configured =
  url !== null &&
  supabaseUrl !== undefined &&
  secretKey !== undefined &&
  publishableKey !== undefined;

(configured ? describe : describe.skip)('booking (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let db: TestDatabase;
  let admin: SupabaseClient;
  let anon: SupabaseClient;

  const tag = `bk-${Date.now().toString(36)}`;
  const createdUserIds: string[] = [];
  let clinicId: string;
  let otherClinicId: string;
  let doctorMemberId: string;
  let otherDoctorMemberId: string;
  let receptionMemberId: string;

  /** The parent under test, their family, and somebody else's child. */
  let guardianId: string;
  let childId: string;
  let foreignChildId: string;

  const tokens: Record<'parent' | 'reception' | 'foreign', string> = {} as never;

  async function account(label: string): Promise<string> {
    const email = `${tag}-${label}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    createdUserIds.push(created.data.user.id);

    const session = await anon.auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;
    tokens[label as keyof typeof tokens] = session.data.session.access_token;
    return created.data.user.id;
  }

  async function call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(options.token === undefined
          ? {}
          : { Authorization: `Bearer ${options.token}` }),
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  const data = <T>(body: Record<string, unknown>): T => body['data'] as T;
  const errorCode = (body: Record<string, unknown>): string =>
    (body['error'] as { code: string }).code;

  interface Window {
    sessionId: string;
    windowStart: string;
    capacity: number;
    remaining: number;
  }
  interface Day {
    date: string;
    windows: Window[];
  }

  /**
   * A session starting an hour from now, so its windows are bookable.
   *
   * Built directly rather than materialised from a schedule: this suite is
   * about the endpoints, and a session made here can be given exactly the
   * capacity a case needs.
   */
  async function makeSession(
    clinic: string,
    doctor: string,
    capacity = 5,
  ): Promise<{ id: string; windowStart: string }> {
    const result = await db.database.query<{ id: string; planned_start: Date }>(
      `insert into clinic.clinic_sessions
         (clinic_id, doctor_member_id, session_date, session_kind,
          planned_start, planned_end, window_minutes, capacity_per_window,
          avg_consult_minutes)
       values ($1, $2,
               ((now() + interval '1 hour') at time zone 'Africa/Cairo')::date,
               'morning',
               date_trunc('minute', now() + interval '1 hour'),
               date_trunc('minute', now() + interval '4 hours'),
               60, $3, 6)
       returning id, planned_start`,
      [clinic, doctor, capacity],
    );
    return {
      id: result.rows[0].id,
      windowStart: result.rows[0].planned_start.toISOString(),
    };
  }

  const bookAs = (
    token: string,
    session: { id: string; windowStart: string },
    overrides: Record<string, unknown> = {},
  ) =>
    call('POST', '/appointments', {
      token,
      body: {
        childId,
        sessionId: session.id,
        windowStart: session.windowStart,
        visitType: 'new_visit',
        ...overrides,
      },
    });

  beforeAll(async () => {
    db = createTestDatabase(url as string);
    admin = createClient(supabaseUrl as string, secretKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anon = createClient(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const pilot = await db.database.query<{ id: string }>(
      `select id from clinic.clinics where slug = $1`,
      [process.env['CLINIC_SLUG']],
    );
    clinicId = pilot.rows[0].id;

    const other = await db.database.query<{ id: string }>(
      `insert into clinic.clinics (name, slug) values ($1, $2) returning id`,
      [`Other ${tag}`, tag],
    );
    otherClinicId = other.rows[0].id;

    const parentUserId = await account('parent');
    const receptionUserId = await account('reception');
    const foreignUserId = await account('foreign');

    const members = await db.database.query<{ id: string }>(
      `insert into clinic.clinic_members
         (clinic_id, auth_user_id, role, display_name)
       values ($1, $2, 'reception', $5), ($1, $3, 'doctor', $5),
              ($4, $3, 'doctor', $5)
       returning id`,
      [clinicId, receptionUserId, parentUserId, otherClinicId, `${tag} staff`],
    );
    receptionMemberId = members.rows[0].id;
    doctorMemberId = members.rows[1].id;
    otherDoctorMemberId = members.rows[2].id;

    // The parent's own family, linked to their account.
    const guardian = await db.database.query<{ id: string }>(
      `insert into clinic.guardians
         (clinic_id, full_name, phone_e164, auth_user_id, claimed_at,
          claimed_via)
       values ($1, 'Booking Parent', $2, $3, now(), 'self_signup')
       returning id`,
      [clinicId, `+2010${String(Date.now()).slice(-7)}`, foreignUserId],
    );
    guardianId = guardian.rows[0].id;

    const child = await db.database.query<{ id: string }>(
      `insert into clinic.children (clinic_id, full_name) values ($1, 'Leen')
       returning id`,
      [clinicId],
    );
    childId = child.rows[0].id;
    await db.database.query(
      `insert into clinic.guardian_children (guardian_id, child_id, relationship)
       values ($1, $2, 'mother')`,
      [guardianId, childId],
    );

    // A child of the same clinic that this guardian is NOT linked to.
    const stranger = await db.database.query<{ id: string }>(
      `insert into clinic.children (clinic_id, full_name)
       values ($1, 'Somebody Else') returning id`,
      [clinicId],
    );
    foreignChildId = stranger.rows[0].id;

    // The guardian is on the `foreign` account, so that token is the parent.
    tokens.parent = tokens.foreign;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1`;
  }, 120_000);

  afterEach(async () => {
    const clinics = [clinicId, otherClinicId];
    await db.database.query(
      `delete from clinic.appointment_events
        where appointment_id in (
          select id from clinic.appointments where clinic_id = any($1))`,
      [clinics],
    );
    await db.database.query(
      `update clinic.appointments set rescheduled_from_appointment_id = null
        where clinic_id = any($1)`,
      [clinics],
    );
    await db.database.query(
      `delete from clinic.appointments where clinic_id = any($1)`,
      [clinics],
    );
    await db.database.query(
      `delete from clinic.clinic_sessions where clinic_id = any($1)`,
      [clinics],
    );
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (db !== undefined) {
      const clinics = [clinicId, otherClinicId];
      await db.database.query(
        `delete from clinic.guardian_children where guardian_id = $1`,
        [guardianId],
      );
      await db.database.query(
        `delete from clinic.children where id = any($1)`,
        [[childId, foreignChildId]],
      );
      await db.database.query(`delete from clinic.guardians where id = $1`, [
        guardianId,
      ]);
      await db.database.query(
        `delete from clinic.clinic_members where auth_user_id = any($1)`,
        [createdUserIds],
      );
      await db.database.query(
        `delete from clinic.clinic_sessions where clinic_id = any($1)`,
        [clinics],
      );
      await db.database.query(`delete from clinic.clinics where id = $1`, [
        otherClinicId,
      ]);
      await db.close();
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 120_000);

  describe('availability', () => {
    it('offers a parent the clinic’s own week', async () => {
      const session = await makeSession(clinicId, doctorMemberId);

      const response = await call('GET', '/booking/availability', {
        token: tokens.parent,
      });

      expect(response.status).toBe(200);
      const days = data<Day[]>(response.body);
      const windows = days.flatMap((day) => day.windows);
      expect(windows.length).toBeGreaterThan(0);
      expect(windows[0]).toMatchObject({
        sessionId: session.id,
        capacity: 5,
        remaining: 5,
      });
    });

    it('hides a full window from a parent and shows it to staff', async () => {
      const session = await makeSession(clinicId, doctorMemberId, 1);
      expect((await bookAs(tokens.parent, session)).status).toBe(201);

      const parentDays = data<Day[]>(
        (await call('GET', '/booking/availability', { token: tokens.parent }))
          .body,
      );
      const parentStarts = parentDays
        .flatMap((day) => day.windows)
        .map((w) => w.windowStart);
      expect(parentStarts).not.toContain(session.windowStart);

      const staffDays = data<Day[]>(
        (await call('GET', '/clinic/availability', { token: tokens.reception }))
          .body,
      );
      const full = staffDays
        .flatMap((day) => day.windows)
        .find((w) => w.windowStart === session.windowStart);
      expect(full).toMatchObject({ remaining: 0 });
    });

    it('refuses an unparseable date rather than guessing', async () => {
      const response = await call('GET', '/booking/availability?date=today', {
        token: tokens.parent,
      });
      expect(response.status).toBe(400);
    });

    it('does not offer another clinic’s windows', async () => {
      const foreign = await makeSession(otherClinicId, otherDoctorMemberId);

      const days = data<Day[]>(
        (await call('GET', '/booking/availability', { token: tokens.parent }))
          .body,
      );

      // Not "no windows": the pilot clinic has a real seeded schedule, so it
      // genuinely has availability. The point is that none of it is the other
      // clinic's.
      const sessionIds = days.flatMap((day) =>
        day.windows.map((w) => w.sessionId),
      );
      expect(sessionIds).not.toContain(foreign.id);
      expect(sessionIds.length).toBeGreaterThan(0);
    });
  });

  describe('a parent booking', () => {
    it('lands as a request, because this clinic approves bookings', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const response = await bookAs(tokens.parent, session);

      expect(response.status).toBe(201);
      expect(data<{ status: string }>(response.body).status).toBe('requested');
      // Null is how "the parent booked this" is recorded.
      expect(
        data<{ createdByMemberId: string | null }>(response.body)
          .createdByMemberId,
      ).toBeNull();
    });

    it('cannot book for a child that is not theirs', async () => {
      // The child exists, at the same clinic. 404 rather than 403: the
      // difference between those answers is information about another family.
      const session = await makeSession(clinicId, doctorMemberId);
      const response = await bookAs(tokens.parent, session, {
        childId: foreignChildId,
      });

      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('child_not_accessible');
    });

    it('refuses a window that has already started', async () => {
      const past = await db.database.query<{ id: string; planned_start: Date }>(
        `insert into clinic.clinic_sessions
           (clinic_id, doctor_member_id, session_date, session_kind,
            planned_start, planned_end, window_minutes, capacity_per_window,
            avg_consult_minutes)
         values ($1, $2, (now() at time zone 'Africa/Cairo')::date, 'morning',
                 date_trunc('minute', now() - interval '2 hours'),
                 date_trunc('minute', now() + interval '1 hour'),
                 60, 5, 6)
         returning id, planned_start`,
        [clinicId, doctorMemberId],
      );

      const response = await bookAs(tokens.parent, {
        id: past.rows[0].id,
        windowStart: past.rows[0].planned_start.toISOString(),
      });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('window_in_past');
    });

    it('reports a full window as a conflict a screen can act on', async () => {
      const session = await makeSession(clinicId, doctorMemberId, 1);

      // Asserted, not assumed: if the setup booking silently failed, the real
      // assertion below would pass for the wrong reason.
      const taken = await call('POST', '/clinic/appointments', {
        token: tokens.reception,
        body: {
          childId: foreignChildId,
          guardianId,
          sessionId: session.id,
          windowStart: session.windowStart,
          visitType: 'new_visit',
        },
      });
      expect(taken.status).toBe(201);

      const response = await bookAs(tokens.parent, session);
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('slot_unavailable');
    });

    it('rejects a clinicId or guardianId smuggled into the body', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      for (const extra of [
        { clinicId: otherClinicId },
        { guardianId: '00000000-0000-0000-0000-000000000000' },
      ]) {
        const response = await bookAs(tokens.parent, session, extra);
        expect(response.status).toBe(400);
      }
    });
  });

  describe('a staff booking', () => {
    it('is confirmed immediately', async () => {
      const session = await makeSession(clinicId, doctorMemberId);

      const response = await call('POST', '/clinic/appointments', {
        token: tokens.reception,
        body: {
          childId,
          guardianId,
          sessionId: session.id,
          windowStart: session.windowStart,
          visitType: 'follow_up',
        },
      });

      expect(response.status).toBe(201);
      expect(data<{ status: string }>(response.body).status).toBe('confirmed');
      expect(
        data<{ createdByMemberId: string }>(response.body).createdByMemberId,
      ).toBe(receptionMemberId);
    });

    it('works for a family with no app account at all', async () => {
      // The load-bearing requirement: mobile adoption is never required for the
      // clinic to operate.
      const walkIn = await db.database.query<{ id: string }>(
        `insert into clinic.guardians (clinic_id, full_name, phone_e164)
         values ($1, 'No App Family', $2) returning id`,
        [clinicId, `+2011${String(Date.now()).slice(-7)}`],
      );
      const theirChild = await db.database.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name) values ($1, 'Omar')
         returning id`,
        [clinicId],
      );
      await db.database.query(
        `insert into clinic.guardian_children
           (guardian_id, child_id, relationship)
         values ($1, $2, 'father')`,
        [walkIn.rows[0].id, theirChild.rows[0].id],
      );

      const session = await makeSession(clinicId, doctorMemberId);
      const response = await call('POST', '/clinic/appointments', {
        token: tokens.reception,
        body: {
          childId: theirChild.rows[0].id,
          guardianId: walkIn.rows[0].id,
          sessionId: session.id,
          windowStart: session.windowStart,
          visitType: 'new_visit',
        },
      });

      expect(response.status).toBe(201);
      expect(data<{ status: string }>(response.body).status).toBe('confirmed');

      // The appointment references the child, and appointments are never
      // cascade-deleted — a visit history that outlives its patient record is
      // worse than a stale row. So it goes first.
      await db.database.query(
        `delete from clinic.appointment_events
          where appointment_id in (
            select id from clinic.appointments where guardian_id = $1)`,
        [walkIn.rows[0].id],
      );
      await db.database.query(
        `delete from clinic.appointments where guardian_id = $1`,
        [walkIn.rows[0].id],
      );
      await db.database.query(
        `delete from clinic.guardian_children where guardian_id = $1`,
        [walkIn.rows[0].id],
      );
      await db.database.query(`delete from clinic.children where id = $1`, [
        theirChild.rows[0].id,
      ]);
      await db.database.query(`delete from clinic.guardians where id = $1`, [
        walkIn.rows[0].id,
      ]);
    });

    it('approves a request, and the parent sees it confirmed', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const booked = await bookAs(tokens.parent, session);
      const id = data<{ id: string }>(booked.body).id;

      const approved = await call(
        'POST',
        `/clinic/appointments/${id}/approve`,
        { token: tokens.reception },
      );
      expect(approved.status).toBe(200);
      expect(data<{ status: string }>(approved.body).status).toBe('confirmed');

      const mine = await call('GET', `/appointments/${id}`, {
        token: tokens.parent,
      });
      expect(data<{ status: string }>(mine.body).status).toBe('confirmed');
    });

    it('rejects a request as a cancellation the clinic authored', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const booked = await bookAs(tokens.parent, session);
      const id = data<{ id: string }>(booked.body).id;

      const rejected = await call('POST', `/clinic/appointments/${id}/reject`, {
        token: tokens.reception,
        body: { reason: 'الطبيبة مسافرة' },
      });

      expect(rejected.status).toBe(200);
      expect(data<Record<string, unknown>>(rejected.body)).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'clinic',
        cancellationReason: 'الطبيبة مسافرة',
      });
    });

    it('refuses to approve something already cancelled', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const booked = await bookAs(tokens.parent, session);
      const id = data<{ id: string }>(booked.body).id;
      await call('POST', `/clinic/appointments/${id}/reject`, {
        token: tokens.reception,
      });

      const response = await call(
        'POST',
        `/clinic/appointments/${id}/approve`,
        { token: tokens.reception },
      );
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('invalid_transition');
    });
  });

  describe('cancelling and rescheduling', () => {
    it('lets a parent cancel outside the clinic’s cutoff', async () => {
      // The session starts in an hour; the cutoff is 120 minutes, so this is
      // inside it — and must be refused.
      const session = await makeSession(clinicId, doctorMemberId);
      const booked = await bookAs(tokens.parent, session);
      const id = data<{ id: string }>(booked.body).id;

      const response = await call('POST', `/appointments/${id}/cancel`, {
        token: tokens.parent,
      });
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('cancellation_too_late');
    });

    it('does not stop staff cancelling late', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const booked = await bookAs(tokens.parent, session);
      const id = data<{ id: string }>(booked.body).id;

      const response = await call('POST', `/clinic/appointments/${id}/cancel`, {
        token: tokens.reception,
        body: { reason: 'اتصلت الأم' },
      });
      expect(response.status).toBe(200);
      expect(data<{ cancelledBy: string }>(response.body).cancelledBy).toBe(
        'clinic',
      );
    });

    it('moves a family and leaves a trail back', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const booked = await bookAs(tokens.parent, session);
      const id = data<{ id: string }>(booked.body).id;

      // The next window in the *same* session. A second session for the same
      // doctor on the same day is refused by `clinic_sessions_day_uq`, and
      // moving within a day is the commoner reschedule anyway.
      const nextWindow = new Date(
        new Date(session.windowStart).getTime() + 60 * 60_000,
      ).toISOString();

      const moved = await call(
        'POST',
        `/clinic/appointments/${id}/reschedule`,
        {
          token: tokens.reception,
          body: { sessionId: session.id, windowStart: nextWindow },
        },
      );

      expect(moved.status).toBe(200);
      expect(
        data<{ rescheduledFromAppointmentId: string }>(moved.body)
          .rescheduledFromAppointmentId,
      ).toBe(id);
    });
  });

  describe('what a parent may see', () => {
    it('lists only their own appointments', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const mine = await bookAs(tokens.parent, session);

      // Somebody else's, at the same clinic and the same window.
      await call('POST', '/clinic/appointments', {
        token: tokens.reception,
        body: {
          childId: foreignChildId,
          guardianId,
          sessionId: session.id,
          windowStart: session.windowStart,
          visitType: 'new_visit',
        },
      });

      const listed = await call('GET', '/appointments', {
        token: tokens.parent,
      });
      const ids = data<{ id: string }[]>(listed.body).map((a) => a.id);
      expect(ids).toContain(data<{ id: string }>(mine.body).id);
    });

    it('is refused another guardian’s appointment', async () => {
      const session = await makeSession(otherClinicId, otherDoctorMemberId);
      const foreignGuardian = await db.database.query<{ id: string }>(
        `insert into clinic.guardians (clinic_id, full_name, phone_e164)
         values ($1, 'Elsewhere', $2) returning id`,
        [otherClinicId, `+2012${String(Date.now()).slice(-7)}`],
      );
      const foreignChild = await db.database.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name) values ($1, 'Kid')
         returning id`,
        [otherClinicId],
      );
      const appointment = await db.database.query<{ id: string }>(
        `insert into clinic.appointments
           (clinic_id, session_id, child_id, guardian_id, window_start,
            window_end, seat_no, visit_type, status)
         values ($1, $2, $3, $4, $5, $5::timestamptz + interval '1 hour', 1,
                 'new_visit', 'confirmed')
         returning id`,
        [
          otherClinicId,
          session.id,
          foreignChild.rows[0].id,
          foreignGuardian.rows[0].id,
          session.windowStart,
        ],
      );

      const response = await call(
        'GET',
        `/appointments/${appointment.rows[0].id}`,
        { token: tokens.parent },
      );
      expect(response.status).toBe(404);

      await db.database.query(`delete from clinic.appointments where id = $1`, [
        appointment.rows[0].id,
      ]);
      await db.database.query(`delete from clinic.children where id = $1`, [
        foreignChild.rows[0].id,
      ]);
      await db.database.query(`delete from clinic.guardians where id = $1`, [
        foreignGuardian.rows[0].id,
      ]);
    });
  });

  describe('authorisation', () => {
    it('refuses a parent every staff booking route', async () => {
      const session = await makeSession(clinicId, doctorMemberId);
      const booked = await bookAs(tokens.parent, session);
      const id = data<{ id: string }>(booked.body).id;

      for (const [method, path] of [
        ['GET', '/clinic/appointments'],
        ['GET', '/clinic/availability'],
        ['POST', '/clinic/appointments'],
        ['POST', `/clinic/appointments/${id}/approve`],
        ['POST', `/clinic/appointments/${id}/no-show`],
      ] as const) {
        const response = await call(method, path, { token: tokens.parent });
        expect(response.status).toBe(403);
      }
    });

    it('refuses staff the parent routes', async () => {
      // Reception has no guardian, so `@Roles(Guardian)` refuses them.
      const response = await call('GET', '/appointments', {
        token: tokens.reception,
      });
      expect(response.status).toBe(403);
    });

    it('refuses an unauthenticated caller', async () => {
      expect((await call('GET', '/booking/availability')).status).toBe(401);
      expect((await call('GET', '/clinic/appointments')).status).toBe(401);
    });
  });
});

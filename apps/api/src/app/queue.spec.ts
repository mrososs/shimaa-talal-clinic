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
 * The queue and the workflows above it, over real HTTP.
 *
 * What matters here is the join between two domains. Check-in has to create a
 * queue entry AND move an appointment; cancelling has to remove the entry as
 * well as the booking. Either half alone leaves the clinic with a patient on
 * the board nobody expects, or a family waiting who is not on it.
 *
 * And what a parent can see: a count and their own row, never anyone else's.
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

(configured ? describe : describe.skip)('queue (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let db: TestDatabase;
  let admin: SupabaseClient;
  let anon: SupabaseClient;

  const tag = `q-${Date.now().toString(36)}`;
  const createdUserIds: string[] = [];

  /**
   * Children a single test invented, cleaned up in `afterEach`.
   *
   * Not deleted inline after the assertions: cleanup written there never runs
   * when an assertion fails, and the row it leaves behind then breaks a later
   * suite instead of this one.
   */
  const strangerChildIds: string[] = [];
  let clinicId: string;
  let doctorMemberId: string;
  let guardianId: string;
  let childId: string;
  let siblingId: string;
  let sessionId: string;

  /** A second family at the same clinic. Nothing of theirs may ever be visible. */
  let otherGuardianId: string;
  let otherChildId: string;

  /** A second clinic, so "scoped by clinic" is proven and not assumed. */
  let otherClinicId: string;
  let otherClinicSessionId: string;

  const tokens: Record<
    'parent' | 'other' | 'reception' | 'doctor' | 'elsewhere',
    string
  > = {} as never;

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

  interface Entry {
    id: string;
    ticketNumber: number;
    status: string;
    appointmentId: string | null;
    isEmergency: boolean;
    child?: { id: string; fullName: string };
    guardian?: { id: string; fullName: string } | null;
    emergencyReason?: string | null;
  }

  interface Board {
    revision: number;
    changed?: false;
    session?: { id: string; revision: number };
    entries?: Entry[];
    notArrived?: { id: string; child: { fullName: string }; isLate: boolean }[];
  }

  interface ParentEntry {
    id: string;
    ticketNumber: number;
    status: string;
    aheadCount: number;
    calledAt: string | null;
    graceExpiresAt: string | null;
    estimatedWaitMinutes: { from: number; to: number } | null;
    deferCount: number;
    isEmergency: boolean;
  }

  interface ParentItem {
    childId: string;
    childName: string;
    appointment: { id: string; status: string } | null;
    queueEntry: ParentEntry | null;
    session: {
      status: string;
      doctorPresence: string;
      delayMinutes: number | null;
      avgConsultMinutes: number;
      revision: number;
    };
  }

  interface ParentView {
    items?: ParentItem[];
    revision: number;
    changed?: false;
  }

  const mine = async (
    since?: number,
    token = tokens.parent,
  ): Promise<ParentView> => {
    const query = since === undefined ? '' : `?since=${since}`;
    const response = await call('GET', `/queue/me${query}`, { token });
    expect(response.status).toBe(200);
    return data<ParentView>(response.body);
  };

  /** The doctor is here and the day is running — the estimate's precondition. */
  const doctorArrived = () =>
    call('POST', `/clinic/sessions/${sessionId}/doctor-presence`, {
      token: tokens.reception,
      body: { presence: 'arrived' },
    });

  const board = async (since?: number): Promise<Board> => {
    const query =
      since === undefined ? '' : `&since=${since}`;
    const response = await call(
      'GET',
      `/clinic/queue?sessionId=${sessionId}${query}`,
      { token: tokens.doctor },
    );
    expect(response.status).toBe(200);
    return data<Board>(response.body);
  };

  /** A confirmed appointment in today's session, ready to be checked in. */
  async function bookedAppointment(child = childId): Promise<string> {
    const result = await db.database.query<{ id: string }>(
      `insert into clinic.appointments
         (clinic_id, session_id, child_id, guardian_id, window_start,
          window_end, seat_no, visit_type, status)
       values ($1, $2, $3, $4, now() + interval '1 hour',
               now() + interval '2 hours',
               (select coalesce(max(seat_no), 0) + 1
                  from clinic.appointments where session_id = $2),
               'new_visit', 'confirmed')
       returning id`,
      [clinicId, sessionId, child, guardianId],
    );
    return result.rows[0].id;
  }

  const walkIn = (child = childId) =>
    call('POST', '/clinic/queue/walk-in', {
      token: tokens.reception,
      body: { sessionId, childId: child, guardianId },
    });

  beforeAll(async () => {
    db = createTestDatabase(url as string);
    admin = createClient(supabaseUrl as string, secretKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anon = createClient(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const clinic = await db.database.query<{ id: string }>(
      `insert into clinic.clinics
         (name, slug, timezone, default_country_code, grace_period_minutes,
          max_self_defers)
       values ($1, $2, 'Africa/Cairo', 'EG', 10, 2)
       returning id`,
      [`Queue ${tag}`, tag],
    );
    clinicId = clinic.rows[0].id;

    const parentUserId = await account('parent');
    const otherParentUserId = await account('other');
    const receptionUserId = await account('reception');
    const doctorUserId = await account('doctor');
    // The second clinic gets its own account. Giving one auth user a
    // membership at two clinics makes `findByAuthUserId` pick between them by
    // uuid order, so every request that account makes lands at whichever
    // clinic sorted first — which is a coin toss per run, not a test.
    const elsewhereUserId = await account('elsewhere');

    const members = await db.database.query<{ id: string }>(
      `insert into clinic.clinic_members
         (clinic_id, auth_user_id, role, display_name)
       values ($1, $2, 'reception', $4), ($1, $3, 'doctor', $4)
       returning id`,
      [clinicId, receptionUserId, doctorUserId, `${tag} staff`],
    );
    doctorMemberId = members.rows[1].id;

    const guardian = await db.database.query<{ id: string }>(
      `insert into clinic.guardians
         (clinic_id, full_name, phone_e164, auth_user_id, claimed_at,
          claimed_via)
       values ($1, 'Queue Parent', $2, $3, now(), 'self_signup')
       returning id`,
      [clinicId, `+2010${String(Date.now()).slice(-7)}`, parentUserId],
    );
    guardianId = guardian.rows[0].id;

    const kids = await db.database.query<{ id: string }>(
      `insert into clinic.children (clinic_id, full_name)
       values ($1, 'Leen'), ($1, 'Yusuf') returning id`,
      [clinicId],
    );
    childId = kids.rows[0].id;
    siblingId = kids.rows[1].id;
    await db.database.query(
      `insert into clinic.guardian_children (guardian_id, child_id, relationship)
       values ($1, $2, 'mother'), ($1, $3, 'mother')`,
      [guardianId, childId, siblingId],
    );

    // Another family at the same clinic, with a distinctive name so a leak
    // would be unmistakable in a response body.
    const otherGuardian = await db.database.query<{ id: string }>(
      `insert into clinic.guardians
         (clinic_id, full_name, phone_e164, auth_user_id, claimed_at,
          claimed_via)
       values ($1, 'Other Parent', $2, $3, now(), 'self_signup')
       returning id`,
      [clinicId, `+2011${String(Date.now()).slice(-7)}`, otherParentUserId],
    );
    otherGuardianId = otherGuardian.rows[0].id;

    const otherChild = await db.database.query<{ id: string }>(
      `insert into clinic.children (clinic_id, full_name)
       values ($1, 'Nobody-Elses-Business') returning id`,
      [clinicId],
    );
    otherChildId = otherChild.rows[0].id;
    await db.database.query(
      `insert into clinic.guardian_children (guardian_id, child_id, relationship)
       values ($1, $2, 'father')`,
      [otherGuardianId, otherChildId],
    );

    // A whole other clinic, running its own day.
    const second = await db.database.query<{ id: string }>(
      `insert into clinic.clinics (name, slug, timezone, default_country_code)
       values ($1, $2, 'Africa/Cairo', 'EG') returning id`,
      [`Second ${tag}`, `${tag}-2`],
    );
    otherClinicId = second.rows[0].id;
    const otherMember = await db.database.query<{ id: string }>(
      `insert into clinic.clinic_members
         (clinic_id, auth_user_id, role, display_name)
       values ($1, $2, 'doctor', 'Other Clinic Doctor') returning id`,
      [otherClinicId, elsewhereUserId],
    );
    const otherChildElsewhere = await db.database.query<{ id: string }>(
      `insert into clinic.children (clinic_id, full_name)
       values ($1, 'Another-Clinic-Child') returning id`,
      [otherClinicId],
    );
    const otherSession = await db.database.query<{ id: string }>(
      `insert into clinic.clinic_sessions
         (clinic_id, doctor_member_id, session_date, session_kind,
          planned_start, planned_end, window_minutes, capacity_per_window,
          avg_consult_minutes, status)
       values ($1, $2, (now() at time zone 'Africa/Cairo')::date, 'morning',
               now(), now() + interval '6 hours', 60, 20, 6, 'open')
       returning id`,
      [otherClinicId, otherMember.rows[0].id],
    );
    otherClinicSessionId = otherSession.rows[0].id;
    await db.database.query(
      `insert into clinic.queue_entries
         (clinic_id, session_id, child_id, source, ticket_number, sort_key)
       values ($1, $2, $3, 'walk_in', 1, 1000)`,
      [otherClinicId, otherClinicSessionId, otherChildElsewhere.rows[0].id],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1`;
  }, 120_000);

  beforeEach(async () => {
    const session = await db.database.query<{ id: string }>(
      `insert into clinic.clinic_sessions
         (clinic_id, doctor_member_id, session_date, session_kind,
          planned_start, planned_end, window_minutes, capacity_per_window,
          avg_consult_minutes, status)
       values ($1, $2, (now() at time zone 'Africa/Cairo')::date, 'morning',
               now(), now() + interval '6 hours', 60, 20, 6, 'open')
       returning id`,
      [clinicId, doctorMemberId],
    );
    sessionId = session.rows[0].id;
  });

  afterEach(async () => {
    // Events and entries in one statement: an FK ties them together, and two
    // statements leave a window in which anything still in flight can write an
    // event that then blocks the delete.
    await db.database.query(
      `with cleared as (
         delete from clinic.queue_events
          where entry_id in (
            select id from clinic.queue_entries where clinic_id = $1)
          returning entry_id)
       delete from clinic.queue_entries where clinic_id = $1`,
      [clinicId],
    );
    if (strangerChildIds.length > 0) {
      await db.database.query(
        `delete from clinic.children where id = any($1)`,
        [strangerChildIds.splice(0)],
      );
    }
    await db.database.query(
      `with cleared as (
         delete from clinic.appointment_events
          where appointment_id in (
            select id from clinic.appointments where clinic_id = $1)
          returning appointment_id)
       delete from clinic.appointments where clinic_id = $1`,
      [clinicId],
    );
    await db.database.query(
      `delete from clinic.clinic_sessions where clinic_id = $1`,
      [clinicId],
    );
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (db !== undefined) {
      await db.database.query(
        `with cleared as (
           delete from clinic.queue_events where entry_id in (
             select id from clinic.queue_entries where clinic_id = $1)
           returning entry_id)
         delete from clinic.queue_entries where clinic_id = $1`,
        [otherClinicId],
      );
      await db.database.query(
        `delete from clinic.clinic_sessions where clinic_id = $1`,
        [otherClinicId],
      );
      await db.database.query(
        `delete from clinic.children where clinic_id = $1`,
        [otherClinicId],
      );
      await db.database.query(
        `delete from clinic.clinic_members where clinic_id = $1`,
        [otherClinicId],
      );
      await db.database.query(`delete from clinic.clinics where id = $1`, [
        otherClinicId,
      ]);
      await db.database.query(
        `delete from clinic.guardian_children where guardian_id = any($1)`,
        [[guardianId, otherGuardianId]],
      );
      await db.database.query(
        `delete from clinic.children where clinic_id = $1`,
        [clinicId],
      );
      await db.database.query(
        `delete from clinic.guardians where clinic_id = $1`,
        [clinicId],
      );
      await db.database.query(
        `delete from clinic.clinic_members where clinic_id = $1`,
        [clinicId],
      );
      await db.database.query(`delete from clinic.clinics where id = $1`, [
        clinicId,
      ]);
      await db.close();
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 120_000);

  describe('check-in', () => {
    it('creates a queue entry and moves the appointment, together', async () => {
      const appointmentId = await bookedAppointment();

      const response = await call(
        'POST',
        `/clinic/appointments/${appointmentId}/check-in`,
        { token: tokens.reception },
      );

      expect(response.status).toBe(201);
      const entry = data<Entry>(response.body);
      expect(entry).toMatchObject({
        ticketNumber: 1,
        status: 'waiting',
        appointmentId,
      });

      // The other half of the same commit.
      const appointment = await call(
        'GET',
        `/clinic/appointments/${appointmentId}`,
        { token: tokens.reception },
      );
      expect(data<{ status: string }>(appointment.body).status).toBe(
        'checked_in',
      );
    });

    it('answers a double-click with the same entry', async () => {
      const appointmentId = await bookedAppointment();
      const first = await call(
        'POST',
        `/clinic/appointments/${appointmentId}/check-in`,
        { token: tokens.reception },
      );
      const second = await call(
        'POST',
        `/clinic/appointments/${appointmentId}/check-in`,
        { token: tokens.reception },
      );

      expect(data<Entry>(second.body).id).toBe(data<Entry>(first.body).id);

      const count = await db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_entries
          where appointment_id = $1`,
        [appointmentId],
      );
      expect(count.rows[0].count).toBe('1');
    });

    it('survives five desks pressing it at once', async () => {
      const appointmentId = await bookedAppointment();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          call('POST', `/clinic/appointments/${appointmentId}/check-in`, {
            token: tokens.reception,
          }),
        ),
      );

      // Whoever loses the appointment's row lock reads it as already checked
      // in. "Not confirmed" would be a true statement and the wrong answer:
      // the patient is in the queue, which is what was asked for.
      expect(responses.map((r) => r.status)).toEqual([
        201, 201, 201, 201, 201,
      ]);
      const ids = new Set(responses.map((r) => data<Entry>(r.body).id));
      expect(ids.size).toBe(1);

      const count = await db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_entries
          where appointment_id = $1`,
        [appointmentId],
      );
      expect(count.rows[0].count).toBe('1');
    });

    it('leaves neither half behind when the appointment is not confirmed', async () => {
      // A requested appointment is not eligible. If the workflow were not one
      // transaction, this is where a queue entry would appear for a visit the
      // clinic has not accepted.
      const appointment = await db.database.query<{ id: string }>(
        `insert into clinic.appointments
           (clinic_id, session_id, child_id, guardian_id, window_start,
            window_end, seat_no, visit_type, status)
         values ($1, $2, $3, $4, now() + interval '1 hour',
                 now() + interval '2 hours', 9, 'new_visit', 'requested')
         returning id`,
        [clinicId, sessionId, siblingId, guardianId],
      );

      const response = await call(
        'POST',
        `/clinic/appointments/${appointment.rows[0].id}/check-in`,
        { token: tokens.reception },
      );
      expect(response.status).toBe(409);

      const entries = await db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_entries
          where appointment_id = $1`,
        [appointment.rows[0].id],
      );
      expect(entries.rows[0].count).toBe('0');
    });

    it('refuses a doctor, because checking in is the desk’s job', async () => {
      const appointmentId = await bookedAppointment();
      const response = await call(
        'POST',
        `/clinic/appointments/${appointmentId}/check-in`,
        { token: tokens.doctor },
      );
      expect(response.status).toBe(403);
    });
  });

  describe('walk-in', () => {
    it('registers a patient with no appointment at all', async () => {
      const response = await walkIn();

      expect(response.status).toBe(201);
      expect(data<Entry>(response.body)).toMatchObject({
        appointmentId: null,
        status: 'waiting',
      });
    });

    it('shares one ticket sequence with checked-in patients', async () => {
      const appointmentId = await bookedAppointment();
      await call('POST', `/clinic/appointments/${appointmentId}/check-in`, {
        token: tokens.reception,
      });
      const second = await walkIn(siblingId);

      // One queue, one sequence. A walk-in is not a second-class entry.
      expect(data<Entry>(second.body).ticketNumber).toBe(2);
    });
  });

  describe('running the queue', () => {
    it('calls, starts and completes', async () => {
      const first = data<Entry>((await walkIn()).body);

      const called = await call('POST', '/clinic/queue/call-next', {
        token: tokens.reception,
        body: { sessionId },
      });
      expect(data<Entry>(called.body).status).toBe('called');

      const started = await call('POST', `/clinic/queue/${first.id}/start`, {
        token: tokens.doctor,
      });
      expect(data<Entry>(started.body).status).toBe('in_service');

      const done = await call('POST', `/clinic/queue/${first.id}/complete`, {
        token: tokens.doctor,
      });
      expect(data<Entry>(done.body).status).toBe('done');
    });

    it('completes the appointment behind a checked-in patient', async () => {
      const appointmentId = await bookedAppointment();
      const entry = data<Entry>(
        (
          await call(
            'POST',
            `/clinic/appointments/${appointmentId}/check-in`,
            { token: tokens.reception },
          )
        ).body,
      );

      await call('POST', `/clinic/queue/${entry.id}/call`, {
        token: tokens.reception,
      });
      await call('POST', `/clinic/queue/${entry.id}/start`, {
        token: tokens.doctor,
      });
      await call('POST', `/clinic/queue/${entry.id}/complete`, {
        token: tokens.doctor,
      });

      const appointment = await call(
        'GET',
        `/clinic/appointments/${appointmentId}`,
        { token: tokens.reception },
      );
      expect(data<{ status: string }>(appointment.body).status).toBe(
        'completed',
      );
    });

    it('completes a walk-in without an appointment to touch', async () => {
      const entry = data<Entry>((await walkIn()).body);
      await call('POST', `/clinic/queue/${entry.id}/call`, {
        token: tokens.reception,
      });

      const done = await call('POST', `/clinic/queue/${entry.id}/complete`, {
        token: tokens.doctor,
      });
      expect(done.status).toBe(200);
      expect(data<Entry>(done.body).status).toBe('done');
    });

    it('says plainly when nobody is waiting', async () => {
      const response = await call('POST', '/clinic/queue/call-next', {
        token: tokens.reception,
        body: { sessionId },
      });
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('queue_empty');
    });
  });

  describe('the board', () => {
    it('names every patient, in service order', async () => {
      // A board of ticket numbers with no names beside them is unusable at a
      // desk, and the names live in a domain the queue may not read.
      await walkIn();
      await walkIn(siblingId);

      const day = await board();

      expect(day.entries).toHaveLength(2);
      expect(day.entries?.map((e) => e.ticketNumber)).toEqual([1, 2]);
      expect(day.entries?.map((e) => e.child?.fullName)).toEqual([
        'Leen',
        'Yusuf',
      ]);
      expect(day.entries?.[0].guardian?.fullName).toBe('Queue Parent');
    });

    it('keeps who is still expected out of the queue itself', async () => {
      // An appointment is not a place in the line. Merging the two lists would
      // put a patient on the board that "call next" could then announce.
      await bookedAppointment();

      const day = await board();

      expect(day.entries).toHaveLength(0);
      expect(day.notArrived).toHaveLength(1);
      expect(day.notArrived?.[0].child.fullName).toBe('Leen');
      expect(day.notArrived?.[0].isLate).toBe(false);
    });

    it('moves them across when they arrive', async () => {
      const appointmentId = await bookedAppointment();
      await call('POST', `/clinic/appointments/${appointmentId}/check-in`, {
        token: tokens.reception,
      });

      const day = await board();

      expect(day.notArrived).toHaveLength(0);
      expect(day.entries?.map((e) => e.appointmentId)).toEqual([appointmentId]);
    });

    it('shows why somebody was moved ahead', async () => {
      const entry = data<Entry>((await walkIn()).body);
      await call('POST', `/clinic/queue/${entry.id}/emergency`, {
        token: tokens.doctor,
        body: { emergency: true, reason: 'صعوبة في التنفس' },
      });

      const day = await board();
      expect(day.entries?.[0].emergencyReason).toBe('صعوبة في التنفس');
    });

    it('answers a poll that is already current in two numbers', async () => {
      await walkIn();
      const first = await board();

      const again = await board(first.revision);

      expect(again.changed).toBe(false);
      expect(again.entries).toBeUndefined();
      expect(again.notArrived).toBeUndefined();
    });

    it('sends the board again once somebody moves', async () => {
      const entry = data<Entry>((await walkIn()).body);
      const before = await board();

      await call('POST', `/clinic/queue/${entry.id}/call`, {
        token: tokens.reception,
      });

      const after = await board(before.revision);
      expect(after.changed).toBeUndefined();
      expect(after.entries?.[0].status).toBe('called');
    });
  });

  describe('the day', () => {
    it('lists today without being told the date', async () => {
      const response = await call('GET', '/clinic/sessions', {
        token: tokens.reception,
      });

      expect(response.status).toBe(200);
      const sessions = data<{ id: string; status: string }[]>(response.body);
      // "Today" is a fact about Cairo, not about wherever this runs.
      expect(sessions.map((session) => session.id)).toContain(sessionId);
    });

    it('stops the queue advancing while it is paused', async () => {
      await walkIn();
      const paused = await call('POST', `/clinic/sessions/${sessionId}/pause`, {
        token: tokens.reception,
      });
      expect(data<{ status: string }>(paused.body).status).toBe('paused');

      const refused = await call('POST', '/clinic/queue/call-next', {
        token: tokens.reception,
        body: { sessionId },
      });
      expect(refused.status).toBe(409);
      expect(errorCode(refused.body)).toBe('queue_session_not_running');

      await call('POST', `/clinic/sessions/${sessionId}/resume`, {
        token: tokens.reception,
      });
      const called = await call('POST', '/clinic/queue/call-next', {
        token: tokens.reception,
        body: { sessionId },
      });
      expect(called.status).toBe(200);
    });

    it('refuses to reopen a day that was closed', async () => {
      await call('POST', `/clinic/sessions/${sessionId}/close`, {
        token: tokens.reception,
      });

      const response = await call('POST', `/clinic/sessions/${sessionId}/open`, {
        token: tokens.reception,
      });
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('session_closed');
    });

    it('records the doctor running late, and clears it on arrival', async () => {
      const late = await call(
        `POST`,
        `/clinic/sessions/${sessionId}/doctor-presence`,
        {
          token: tokens.reception,
          body: { presence: 'en_route', delayMinutes: 20, note: 'في الطريق' },
        },
      );
      expect(data<{ delayMinutes: number }>(late.body)).toMatchObject({
        doctorPresence: 'en_route',
        delayMinutes: 20,
      });

      // A stale "20 minutes late" on a doctor who is here is worse than saying
      // nothing at all.
      const here = await call(
        'POST',
        `/clinic/sessions/${sessionId}/doctor-presence`,
        { token: tokens.doctor, body: { presence: 'arrived' } },
      );
      expect(data<{ delayMinutes: number | null }>(here.body)).toMatchObject({
        doctorPresence: 'arrived',
        delayMinutes: null,
      });
    });

    it('takes a new pace and refuses an impossible one', async () => {
      const updated = await call('PATCH', `/clinic/sessions/${sessionId}/pace`, {
        token: tokens.doctor,
        body: { avgConsultMinutes: 12 },
      });
      expect(data<{ avgConsultMinutes: number }>(updated.body).avgConsultMinutes)
        .toBe(12);

      const refused = await call('PATCH', `/clinic/sessions/${sessionId}/pace`, {
        token: tokens.doctor,
        body: { avgConsultMinutes: 0 },
      });
      expect(refused.status).toBe(400);
    });

    it('moves the revision, so every watcher learns it changed', async () => {
      // The revision is the token both apps poll against. A session change that
      // did not move it would be told "unchanged" forever — a paused queue that
      // still reads as running on every phone in the waiting room.
      const before = await board();

      await call('POST', `/clinic/sessions/${sessionId}/pause`, {
        token: tokens.reception,
      });
      const paused = await board();
      expect(paused.revision).toBeGreaterThan(before.revision);

      await call('POST', `/clinic/sessions/${sessionId}/doctor-presence`, {
        token: tokens.reception,
        body: { presence: 'arrived' },
      });
      const present = await board();
      expect(present.revision).toBeGreaterThan(paused.revision);

      await call('PATCH', `/clinic/sessions/${sessionId}/pace`, {
        token: tokens.doctor,
        body: { avgConsultMinutes: 9 },
      });
      expect((await board()).revision).toBeGreaterThan(present.revision);
    });

    it('is not the parent’s to operate', async () => {
      const response = await call('POST', `/clinic/sessions/${sessionId}/pause`, {
        token: tokens.parent,
      });
      expect(response.status).toBe(403);
    });
  });

  describe('emergency', () => {
    it('moves a patient ahead without changing anyone’s number', async () => {
      const first = data<Entry>((await walkIn()).body);
      const urgent = data<Entry>((await walkIn(siblingId)).body);

      const marked = await call(
        'POST',
        `/clinic/queue/${urgent.id}/emergency`,
        {
          token: tokens.doctor,
          body: { emergency: true, reason: 'صعوبة في التنفس' },
        },
      );

      expect(marked.status).toBe(200);
      expect(data<Entry>(marked.body)).toMatchObject({
        isEmergency: true,
        ticketNumber: urgent.ticketNumber,
      });

      const day = await board();
      expect(day.entries?.map((e) => e.id)).toEqual([urgent.id, first.id]);
    });

    it('refuses an emergency with no reason', async () => {
      const entry = data<Entry>((await walkIn()).body);
      const response = await call(
        'POST',
        `/clinic/queue/${entry.id}/emergency`,
        { token: tokens.doctor, body: { emergency: true } },
      );
      expect(response.status).toBe(400);
    });
  });

  describe('grace', () => {
    it('refuses to skip a patient who still has time', async () => {
      const entry = data<Entry>((await walkIn()).body);
      await call('POST', `/clinic/queue/${entry.id}/call`, {
        token: tokens.reception,
      });

      const response = await call('POST', `/clinic/queue/${entry.id}/miss`, {
        token: tokens.reception,
        body: {},
      });
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('queue_grace_not_expired');
    });

    it('allows an override with a reason, then a requeue', async () => {
      const entry = data<Entry>((await walkIn()).body);
      await call('POST', `/clinic/queue/${entry.id}/call`, {
        token: tokens.reception,
      });

      const missed = await call('POST', `/clinic/queue/${entry.id}/miss`, {
        token: tokens.reception,
        body: { force: true, reason: 'اتصلت الأم' },
      });
      expect(data<Entry>(missed.body).status).toBe('missed');

      const back = await call('POST', `/clinic/queue/${entry.id}/requeue`, {
        token: tokens.reception,
      });
      expect(data<Entry>(back.body).status).toBe('waiting');
      // A new number, because they genuinely lost their place.
      expect(data<Entry>(back.body).ticketNumber).toBeGreaterThan(
        entry.ticketNumber,
      );
    });
  });

  describe('cancelling a checked-in appointment', () => {
    it('removes the queue entry too, so no ghost is left on the board', async () => {
      const appointmentId = await bookedAppointment();
      const entry = data<Entry>(
        (
          await call(
            'POST',
            `/clinic/appointments/${appointmentId}/check-in`,
            { token: tokens.reception },
          )
        ).body,
      );

      const cancelled = await call(
        'POST',
        `/clinic/appointments/${appointmentId}/cancel`,
        { token: tokens.reception, body: { reason: 'اتصلت الأم' } },
      );
      expect(cancelled.status).toBe(200);
      expect(data<{ status: string }>(cancelled.body).status).toBe('cancelled');

      // The half that would otherwise be forgotten.
      const row = await db.database.query<{ status: string }>(
        `select status from clinic.queue_entries where id = $1`,
        [entry.id],
      );
      expect(row.rows[0].status).toBe('cancelled');

      const day = await board();
      expect(
        day.entries?.filter((e) => e.status !== 'cancelled'),
      ).toHaveLength(0);
    });
  });

  describe('what a parent sees', () => {
    it('says nothing is happening when nothing is', async () => {
      const view = await mine();
      expect(view.items).toEqual([]);
    });

    it('shows today’s booking before anyone has checked them in', async () => {
      // An appointment is not a place in the line, and the shape says so: the
      // visit is there, the turn is not.
      const appointmentId = await bookedAppointment();

      const view = await mine();

      expect(view.items).toHaveLength(1);
      expect(view.items?.[0]).toMatchObject({
        childId,
        childName: 'Leen',
        queueEntry: null,
      });
      expect(view.items?.[0].appointment).toMatchObject({
        id: appointmentId,
        status: 'confirmed',
      });
    });

    it('counts the patients actually ahead, and nothing else', async () => {
      const others = await db.database.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name)
         values ($1, 'X'), ($1, 'Y') returning id`,
        [clinicId],
      );
      strangerChildIds.push(...others.rows.map((r) => r.id));
      for (const row of others.rows) {
        await call('POST', '/clinic/queue/walk-in', {
          token: tokens.reception,
          body: { sessionId, childId: row.id },
        });
      }
      const ours = data<Entry>((await walkIn()).body);

      const view = await mine();

      expect(view.items).toHaveLength(1);
      expect(view.items?.[0].queueEntry).toMatchObject({
        id: ours.id,
        status: 'waiting',
        aheadCount: 2,
      });

      // The shape has nowhere to put another patient, which is the point.
      expect(JSON.stringify(view)).not.toContain(others.rows[0].id);
    });

    it('says nobody is ahead when nobody is', async () => {
      await walkIn();
      const view = await mine();
      expect(view.items?.[0].queueEntry?.aheadCount).toBe(0);
    });

    it('recounts when an emergency is admitted ahead of them', async () => {
      const ours = data<Entry>((await walkIn()).body);
      const urgent = data<Entry>((await walkIn(siblingId)).body);
      expect((await mine()).items?.[0].queueEntry?.aheadCount).toBe(0);

      await call('POST', `/clinic/queue/${urgent.id}/emergency`, {
        token: tokens.doctor,
        body: { emergency: true, reason: 'صعوبة في التنفس' },
      });

      // Ticket numbers did not move; the count did, because it is a count.
      const after = await mine();
      const item = after.items?.find((i) => i.queueEntry?.id === ours.id);
      expect(item?.queueEntry).toMatchObject({
        ticketNumber: ours.ticketNumber,
        aheadCount: 1,
      });
    });

    it('recounts when staff reorder the line', async () => {
      const ours = data<Entry>((await walkIn()).body);
      const stranger = await db.database.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name) values ($1, 'R')
         returning id`,
        [clinicId],
      );
      strangerChildIds.push(stranger.rows[0].id);
      const theirs = data<Entry>(
        (
          await call('POST', '/clinic/queue/walk-in', {
            token: tokens.reception,
            body: { sessionId, childId: stranger.rows[0].id },
          })
        ).body,
      );
      expect((await mine()).items?.[0].queueEntry?.aheadCount).toBe(0);

      await call('POST', `/clinic/queue/${theirs.id}/move`, {
        token: tokens.reception,
        body: { beforeEntryId: ours.id },
      });

      expect((await mine()).items?.[0].queueEntry?.aheadCount).toBe(1);
    });

    it('puts them at the back after a missed turn is requeued', async () => {
      const ours = data<Entry>((await walkIn()).body);
      await walkIn(siblingId);

      await call('POST', `/clinic/queue/${ours.id}/call`, {
        token: tokens.reception,
      });
      await call('POST', `/clinic/queue/${ours.id}/miss`, {
        token: tokens.reception,
        body: { force: true, reason: 'لم يصل' },
      });

      const missed = await mine();
      const missedItem = missed.items?.find((i) => i.childId === childId);
      expect(missedItem?.queueEntry).toMatchObject({
        status: 'missed',
        // Nobody is ahead of a turn that is no longer pending, and a number
        // left over from when it was waiting would be read as one.
        aheadCount: 0,
        estimatedWaitMinutes: null,
      });

      await call('POST', `/clinic/queue/${ours.id}/requeue`, {
        token: tokens.reception,
      });

      const back = await mine();
      const backItem = back.items?.find((i) => i.childId === childId);
      expect(backItem?.queueEntry?.status).toBe('waiting');
      expect(backItem?.queueEntry?.ticketNumber).toBeGreaterThan(
        ours.ticketNumber,
      );
      // Behind the sibling now, which is what losing your place means.
      expect(backItem?.queueEntry?.aheadCount).toBe(1);
    });

    it('carries the called time and the deadline it promised', async () => {
      const ours = data<Entry>((await walkIn()).body);
      await call('POST', `/clinic/queue/${ours.id}/call`, {
        token: tokens.reception,
      });

      const entry = (await mine()).items?.[0].queueEntry;
      expect(entry?.status).toBe('called');
      expect(entry?.calledAt).not.toBeNull();
      expect(entry?.graceExpiresAt).not.toBeNull();

      // The clinic's own grace policy, ten minutes, as a real instant the app
      // may count down to.
      const remaining =
        Date.parse(entry?.graceExpiresAt as string) - Date.now();
      expect(remaining).toBeGreaterThan(8 * 60_000);
      expect(remaining).toBeLessThanOrEqual(10 * 60_000);
    });

    it('reports the queue paused', async () => {
      await walkIn();
      await call('POST', `/clinic/sessions/${sessionId}/pause`, {
        token: tokens.reception,
      });

      const view = await mine();
      expect(view.items?.[0].session.status).toBe('paused');
      // A paused queue is not moving, so there is nothing honest to estimate.
      expect(view.items?.[0].queueEntry?.estimatedWaitMinutes).toBeNull();
    });

    it('reports the doctor running late, with the delay staff entered', async () => {
      await walkIn();
      await call('POST', `/clinic/sessions/${sessionId}/doctor-presence`, {
        token: tokens.reception,
        body: { presence: 'en_route', delayMinutes: 20 },
      });

      const view = await mine();
      expect(view.items?.[0].session).toMatchObject({
        doctorPresence: 'en_route',
        delayMinutes: 20,
      });
      expect(view.items?.[0].queueEntry?.estimatedWaitMinutes).toBeNull();
    });

    it('offers a coarse band only once the doctor is actually here', async () => {
      const others = await db.database.query<{ id: string }>(
        `insert into clinic.children (clinic_id, full_name)
         values ($1, 'P'), ($1, 'Q'), ($1, 'S') returning id`,
        [clinicId],
      );
      strangerChildIds.push(...others.rows.map((r) => r.id));
      for (const row of others.rows) {
        await call('POST', '/clinic/queue/walk-in', {
          token: tokens.reception,
          body: { sessionId, childId: row.id },
        });
      }
      await walkIn();

      expect(
        (await mine()).items?.[0].queueEntry?.estimatedWaitMinutes,
      ).toBeNull();

      await doctorArrived();

      // Three ahead at six minutes each: a range, never a countdown.
      expect((await mine()).items?.[0].queueEntry?.estimatedWaitMinutes).toEqual(
        { from: 20, to: 30 },
      );
    });

    it('lists both children when a family has two in the clinic', async () => {
      const first = data<Entry>((await walkIn()).body);
      const second = data<Entry>((await walkIn(siblingId)).body);

      const view = await mine();

      expect(view.items).toHaveLength(2);
      expect(view.items?.map((i) => i.childName).sort()).toEqual([
        'Leen',
        'Yusuf',
      ]);
      expect(view.items?.map((i) => i.queueEntry?.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
    });

    it('moves its revision when the queue moves, and holds still otherwise', async () => {
      const entry = data<Entry>((await walkIn()).body);
      const first = await mine();
      expect(first.revision).toBeGreaterThan(0);

      // An unchanged poll answers in two numbers.
      const unchanged = await mine(first.revision);
      expect(unchanged.changed).toBe(false);
      expect(unchanged.items).toBeUndefined();

      await call('POST', `/clinic/queue/${entry.id}/call`, {
        token: tokens.reception,
      });

      const after = await mine(first.revision);
      expect(after.changed).toBeUndefined();
      expect(after.items?.[0].queueEntry?.status).toBe('called');
      expect(after.revision).toBeGreaterThan(first.revision);
    });

    it('is refused the staff board entirely', async () => {
      const response = await call(
        'GET',
        `/clinic/queue?sessionId=${sessionId}`,
        { token: tokens.parent },
      );
      expect(response.status).toBe(403);
    });

    it('can defer once, and is stopped at the clinic’s limit', async () => {
      const ours = data<Entry>((await walkIn()).body);
      await walkIn(siblingId);

      const first = await call('POST', `/queue/${ours.id}/defer`, {
        token: tokens.parent,
      });
      expect(first.status).toBe(200);
      expect(data<{ deferCount: number }>(first.body).deferCount).toBe(1);

      await call('POST', `/queue/${ours.id}/defer`, { token: tokens.parent });

      const third = await call('POST', `/queue/${ours.id}/defer`, {
        token: tokens.parent,
      });
      expect(third.status).toBe(409);
      expect(errorCode(third.body)).toBe('queue_defer_limit_reached');
    });
  });

  describe('one family cannot see another', () => {
    /** Both families in the clinic at once, so isolation is actually tested. */
    async function bothFamilies(): Promise<{ ours: Entry; theirs: Entry }> {
      const theirs = data<Entry>(
        (
          await call('POST', '/clinic/queue/walk-in', {
            token: tokens.reception,
            body: {
              sessionId,
              childId: otherChildId,
              guardianId: otherGuardianId,
            },
          })
        ).body,
      );
      const ours = data<Entry>((await walkIn()).body);
      return { ours, theirs };
    }

    it('returns only the caller’s own children', async () => {
      const { ours } = await bothFamilies();

      const view = await mine();

      expect(view.items).toHaveLength(1);
      expect(view.items?.[0].queueEntry?.id).toBe(ours.id);
    });

    it('leaks no name, id, ticket or appointment belonging to anyone else', async () => {
      const { theirs } = await bothFamilies();
      const appointmentId = await bookedAppointment();

      const body = JSON.stringify(await mine());

      for (const secret of [
        theirs.id,
        otherChildId,
        otherGuardianId,
        'Nobody-Elses-Business',
      ]) {
        expect(body).not.toContain(secret);
      }
      // Our own appointment is ours to see; the check above is about theirs.
      expect(body).toContain(appointmentId);
    });

    it('shows the other family their own turn and only theirs', async () => {
      const { ours } = await bothFamilies();

      const view = await mine(undefined, tokens.other);

      expect(view.items).toHaveLength(1);
      expect(view.items?.[0]).toMatchObject({
        childId: otherChildId,
        childName: 'Nobody-Elses-Business',
      });
      expect(JSON.stringify(view)).not.toContain(ours.id);
      expect(JSON.stringify(view)).not.toContain(childId);
    });

    it('tells a guessed entry id nothing at all', async () => {
      const { theirs } = await bothFamilies();

      // The only route that takes an entry id from a parent. A real id
      // belonging to somebody else answers exactly as an invented one does.
      const real = await call('POST', `/queue/${theirs.id}/defer`, {
        token: tokens.parent,
      });
      const invented = await call(
        'POST',
        '/queue/00000000-0000-4000-8000-000000000000/defer',
        { token: tokens.parent },
      );

      expect(real.status).toBe(404);
      expect(invented.status).toBe(404);
      expect(errorCode(real.body)).toBe(errorCode(invented.body));
      expect(real.body).toEqual(invented.body);
    });

    it('cannot see another clinic’s day at all', async () => {
      await walkIn();

      const view = await mine();

      expect(JSON.stringify(view)).not.toContain(otherClinicId);
      expect(JSON.stringify(view)).not.toContain(otherClinicSessionId);
      expect(JSON.stringify(view)).not.toContain('Another-Clinic-Child');
      // The other clinic has a patient waiting; it must not count here.
      expect(view.items?.[0].queueEntry?.aheadCount).toBe(0);
    });
  });

  describe('authorisation', () => {
    it('refuses a parent every staff command', async () => {
      const entry = data<Entry>((await walkIn()).body);
      for (const path of [
        '/clinic/queue/walk-in',
        '/clinic/queue/call-next',
        `/clinic/queue/${entry.id}/call`,
        `/clinic/queue/${entry.id}/start`,
        `/clinic/queue/${entry.id}/miss`,
        `/clinic/queue/${entry.id}/cancel`,
      ]) {
        const response = await call('POST', path, { token: tokens.parent });
        expect(response.status).toBe(403);
      }
    });

    it('keeps reception-only commands away from the doctor', async () => {
      // The doctor runs the queue but does not remove people from it or
      // reorder it — those are desk decisions.
      const entry = data<Entry>((await walkIn()).body);
      for (const path of [
        '/clinic/queue/walk-in',
        `/clinic/queue/${entry.id}/cancel`,
        `/clinic/queue/${entry.id}/move`,
      ]) {
        const response = await call('POST', path, { token: tokens.doctor });
        expect(response.status).toBe(403);
      }
    });

    it('refuses an unauthenticated caller', async () => {
      expect(
        (await call('GET', `/clinic/queue?sessionId=${sessionId}`)).status,
      ).toBe(401);
      expect((await call('GET', '/queue/me')).status).toBe(401);
    });
  });
});

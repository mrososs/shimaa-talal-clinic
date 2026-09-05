import { VisitType } from '@clinic/contracts';
import { ClinicService, ClinicSessionService } from '@clinic/server-clinic';
import { AppointmentService } from './appointment.service';
import { AvailabilityService } from './availability.service';
import { describeWithDatabase, insertSession } from './booking.fixture';

/**
 * What a parent is offered.
 *
 * The number this produces is advisory and the tests say so — the seat index is
 * what decides. What matters here is that the *shape* is right: windows come
 * from the session's own hours, closures remove the ones they overlap, and a
 * window that has started is never offered.
 */
describeWithDatabase('availability', (fx) => {
  const availability = () =>
    new AvailabilityService(
      fx.db.database,
      new ClinicSessionService(fx.db.database),
    );
  const appointments = () =>
    new AppointmentService(fx.db.database, new ClinicService(fx.db.database));

  /** Today and tomorrow in the clinic's own zone, which is what the API takes. */
  async function clinicDates(): Promise<{ from: string; to: string }> {
    const row = await fx.db.database.query<{ from: string; to: string }>(
      `select (now() at time zone c.timezone)::date::text as from,
              ((now() at time zone c.timezone)::date + 2)::text as to
         from clinic.clinics c where c.id = $1`,
      [fx.clinicId],
    );
    return row.rows[0];
  }

  afterEach(async () => {
    const clinics = [fx.clinicId, fx.otherClinicId];
    await fx.db.database.query(
      `delete from clinic.appointment_events
        where appointment_id in (
          select id from clinic.appointments where clinic_id = any($1))`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.appointments where clinic_id = any($1)`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_sessions where clinic_id = any($1)`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_closures where clinic_id = any($1)`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_schedules where clinic_id = any($1)`,
      [clinics],
    );
  });

  describe('generating windows', () => {
    it('divides a session into windows of its own length', async () => {
      // Three hours of sixty-minute windows.
      const session = await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        startsInMinutes: 60,
        lengthMinutes: 180,
        windowMinutes: 60,
        capacityPerWindow: 5,
      });

      const { from, to } = await clinicDates();
      const days = await availability().forRange(fx.clinicId, { from, to });
      const windows = days.flatMap((day) => day.windows);

      expect(windows).toHaveLength(3);
      expect(windows[0]).toMatchObject({
        sessionId: session.id,
        capacity: 5,
        taken: 0,
        remaining: 5,
      });
      // Contiguous, and the last one ends where the session does.
      expect(windows[0].windowEnd).toBe(windows[1].windowStart);
      expect(windows[1].windowEnd).toBe(windows[2].windowStart);
    });

    it('ends a ragged session with a short window rather than an overrun', async () => {
      // 90 minutes of 60-minute windows: one full, one half.
      await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        startsInMinutes: 60,
        lengthMinutes: 90,
        windowMinutes: 60,
      });

      const { from, to } = await clinicDates();
      const windows = (
        await availability().forRange(fx.clinicId, { from, to })
      ).flatMap((day) => day.windows);

      expect(windows).toHaveLength(2);
      const lastLength =
        new Date(windows[1].windowEnd).getTime() -
        new Date(windows[1].windowStart).getTime();
      expect(lastLength).toBe(30 * 60_000);
    });

    it('counts held seats, including requests', async () => {
      // A requested appointment holds its seat, so approval can never fail on
      // capacity. Availability has to reflect that or it lies to the next
      // parent.
      const session = await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        capacityPerWindow: 3,
      });
      await appointments().create({
        clinicId: fx.clinicId,
        sessionId: session.id,
        windowStart: session.windowStart,
        childId: fx.childId,
        guardianId: fx.guardianId,
        visitType: VisitType.NewVisit,
      });

      const { from, to } = await clinicDates();
      const windows = (
        await availability().forRange(fx.clinicId, { from, to })
      ).flatMap((day) => day.windows);

      expect(windows[0]).toMatchObject({ capacity: 3, taken: 1, remaining: 2 });
    });

    it('hides a full window from a parent and shows it to staff', async () => {
      const session = await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        lengthMinutes: 120,
        capacityPerWindow: 1,
      });
      await appointments().create({
        clinicId: fx.clinicId,
        sessionId: session.id,
        windowStart: session.windowStart,
        childId: fx.childId,
        guardianId: fx.guardianId,
        visitType: VisitType.NewVisit,
      });

      const { from, to } = await clinicDates();

      const parentView = (
        await availability().forRange(fx.clinicId, { from, to })
      ).flatMap((day) => day.windows);
      expect(parentView).toHaveLength(1);
      expect(parentView[0].windowStart).not.toBe(session.windowStart);

      // Staff need to see *why* a day looks empty.
      const staffView = (
        await availability().forRange(fx.clinicId, {
          from,
          to,
          includeFull: true,
        })
      ).flatMap((day) => day.windows);
      expect(staffView).toHaveLength(2);
      expect(staffView[0]).toMatchObject({ remaining: 0 });
    });
  });

  describe('what is not offered', () => {
    it('never offers a window that has already started', async () => {
      await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        startsInMinutes: -60,
        lengthMinutes: 180,
      });

      const { from, to } = await clinicDates();
      const windows = (
        await availability().forRange(fx.clinicId, { from, to })
      ).flatMap((day) => day.windows);

      // The session ran from an hour ago; only the windows still ahead survive.
      for (const window of windows) {
        expect(new Date(window.windowStart).getTime()).toBeGreaterThan(
          Date.now(),
        );
      }
    });

    it('removes windows a closure overlaps, and keeps the rest', async () => {
      const session = await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        startsInMinutes: 60,
        lengthMinutes: 180,
        windowMinutes: 60,
      });

      // Straddles the middle window without containing it: 30 minutes either
      // side of its boundary.
      const middleStart = new Date(
        new Date(session.windowStart).getTime() + 90 * 60_000,
      );
      await fx.db.database.query(
        `insert into clinic.clinic_closures
           (clinic_id, starts_at, ends_at, reason)
         values ($1, $2, $3, 'استراحة')`,
        [
          fx.clinicId,
          middleStart.toISOString(),
          new Date(middleStart.getTime() + 20 * 60_000).toISOString(),
        ],
      );

      const { from, to } = await clinicDates();
      const windows = (
        await availability().forRange(fx.clinicId, { from, to })
      ).flatMap((day) => day.windows);

      expect(windows).toHaveLength(2);
      expect(windows.map((w) => w.windowStart)).not.toContain(
        new Date(
          new Date(session.windowStart).getTime() + 60 * 60_000,
        ).toISOString(),
      );
    });

    it('ignores a closure that belongs to a different doctor', async () => {
      const session = await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        lengthMinutes: 60,
      });

      // A *different* auth user: one account is one member per clinic, which
      // `clinic_members_clinic_user_uq` enforces.
      const otherDoctor = await fx.db.database.query<{ id: string }>(
        `insert into clinic.clinic_members
           (clinic_id, auth_user_id, role, display_name)
         select $1, u.id, 'doctor', 'Locum'
           from auth.users u
          where u.id <> (select auth_user_id from clinic.clinic_members
                          where id = $2)
          order by u.created_at
          limit 1
         returning id`,
        [fx.clinicId, fx.doctorMemberId],
      );

      await fx.db.database.query(
        `insert into clinic.clinic_closures
           (clinic_id, doctor_member_id, starts_at, ends_at, reason)
         values ($1, $2, $3, $4, 'مؤتمر')`,
        [
          fx.clinicId,
          otherDoctor.rows[0].id,
          session.windowStart,
          new Date(
            new Date(session.windowStart).getTime() + 60 * 60_000,
          ).toISOString(),
        ],
      );

      const { from, to } = await clinicDates();
      const windows = (
        await availability().forRange(fx.clinicId, { from, to })
      ).flatMap((day) => day.windows);
      expect(windows).toHaveLength(1);
    });

    it('offers nothing from a closed session', async () => {
      await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        status: 'closed',
      });

      const { from, to } = await clinicDates();
      expect(await availability().forRange(fx.clinicId, { from, to })).toEqual(
        [],
      );
    });

    it('still offers a paused session, which is a queue state', async () => {
      // Pausing stops the queue advancing. It says nothing about whether a
      // window three hours from now can be booked.
      await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        lengthMinutes: 60,
        status: 'paused',
      });

      const { from, to } = await clinicDates();
      const windows = (
        await availability().forRange(fx.clinicId, { from, to })
      ).flatMap((day) => day.windows);
      expect(windows).toHaveLength(1);
    });

    it('does not offer another clinic’s windows', async () => {
      await insertSession(fx.db.database, {
        clinicId: fx.otherClinicId,
        doctorMemberId: fx.otherDoctorMemberId,
      });

      const { from, to } = await clinicDates();
      expect(await availability().forRange(fx.clinicId, { from, to })).toEqual(
        [],
      );
    });
  });

  describe('shape', () => {
    it('groups by clinic-local day, in order', async () => {
      await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        startsInMinutes: 60,
        lengthMinutes: 60,
      });
      await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        // Tomorrow. A different session_kind, because one doctor has one
        // morning per day.
        startsInMinutes: 60 + 24 * 60,
        lengthMinutes: 60,
      });

      const { from, to } = await clinicDates();
      const days = await availability().forRange(fx.clinicId, { from, to });

      expect(days.length).toBeGreaterThanOrEqual(2);
      const dates = days.map((day) => day.date);
      expect([...dates].sort()).toEqual(dates);
      for (const day of days) {
        expect(day.windows.length).toBeGreaterThan(0);
      }
    });

    it('materialises sessions from the schedule when none exist yet', async () => {
      // The first person to look at a day is the one who creates it, which is
      // why a read is allowed to write here.
      const dow = await fx.db.database.query<{ dow: string }>(
        `select extract(dow from (now() at time zone c.timezone)::date + 1)::text as dow
           from clinic.clinics c where c.id = $1`,
        [fx.clinicId],
      );
      await fx.db.database.query(
        `insert into clinic.clinic_schedules
           (clinic_id, doctor_member_id, weekday, session_kind, starts_at,
            ends_at, window_minutes, capacity_per_window, effective_from)
         values ($1, $2, $3, 'morning', '10:00', '13:00', 60, 4, '2000-01-01')`,
        [fx.clinicId, fx.doctorMemberId, Number(dow.rows[0].dow)],
      );

      const dates = await fx.db.database.query<{ from: string; to: string }>(
        `select ((now() at time zone c.timezone)::date + 1)::text as from,
                ((now() at time zone c.timezone)::date + 1)::text as to
           from clinic.clinics c where c.id = $1`,
        [fx.clinicId],
      );

      const days = await availability().forRange(fx.clinicId, dates.rows[0]);

      expect(days).toHaveLength(1);
      expect(days[0].windows).toHaveLength(3);
      expect(days[0].windows[0].capacity).toBe(4);
    });
  });
});

import { AppointmentStatus, VisitType } from '@clinic/contracts';
import { ClinicService } from '@clinic/server-clinic';
import { AppointmentService } from './appointment.service';
import { BookingErrorCode } from './booking.errors';
import {
  describeWithDatabase,
  insertChild,
  insertSession,
} from './booking.fixture';

/**
 * The appointment lifecycle, against a real server.
 *
 * The test that matters most is the capacity race. Everything else here could
 * be reasoned about; whether ten simultaneous bookings for five seats produce
 * exactly five appointments cannot, and it is the guarantee the whole
 * arrival-window model rests on.
 */
describeWithDatabase('appointments', (fx) => {
  const service = () =>
    new AppointmentService(fx.db.database, new ClinicService(fx.db.database));

  afterEach(async () => {
    await fx.db.database.query(
      `delete from clinic.appointment_events
        where appointment_id in (
          select id from clinic.appointments where clinic_id = any($1))`,
      [[fx.clinicId, fx.otherClinicId]],
    );
    await fx.db.database.query(
      `update clinic.appointments set rescheduled_from_appointment_id = null
        where clinic_id = any($1)`,
      [[fx.clinicId, fx.otherClinicId]],
    );
    await fx.db.database.query(
      `delete from clinic.appointments where clinic_id = any($1)`,
      [[fx.clinicId, fx.otherClinicId]],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_sessions where clinic_id = any($1)`,
      [[fx.clinicId, fx.otherClinicId]],
    );
  });

  const book = (
    session: { id: string; windowStart: string },
    overrides: Partial<Parameters<AppointmentService['create']>[0]> = {},
  ) =>
    service().create({
      clinicId: fx.clinicId,
      sessionId: session.id,
      windowStart: session.windowStart,
      childId: fx.childId,
      guardianId: fx.guardianId,
      visitType: VisitType.NewVisit,
      ...overrides,
    });

  const openSession = (
    overrides: Parameters<typeof insertSession>[1] extends infer T
      ? Partial<Omit<T, 'clinicId' | 'doctorMemberId'>>
      : never = {},
  ) =>
    insertSession(fx.db.database, {
      clinicId: fx.clinicId,
      doctorMemberId: fx.doctorMemberId,
      ...overrides,
    });

  describe('booking a window', () => {
    it('lands as a request when the clinic approves bookings', async () => {
      // The pilot's policy: a parent asks, staff accept.
      const session = await openSession();
      const appointment = await book(session);

      expect(appointment.status).toBe(AppointmentStatus.Requested);
      expect(appointment.createdByMemberId).toBeNull();
      expect(appointment.windowStart).toBe(session.windowStart);
    });

    it('is confirmed immediately when staff book it', async () => {
      // The person who would approve it is the person booking it.
      const session = await openSession();
      const appointment = await book(session, {
        createdByMemberId: fx.doctorMemberId,
      });

      expect(appointment.status).toBe(AppointmentStatus.Confirmed);
      expect(appointment.createdByMemberId).toBe(fx.doctorMemberId);
    });

    it('confirms a parent booking when the clinic has said so', async () => {
      await fx.db.database.query(
        `update clinic.clinics set auto_confirm_parent_bookings = true
          where id = $1`,
        [fx.clinicId],
      );
      try {
        const session = await openSession();
        expect((await book(session)).status).toBe(AppointmentStatus.Confirmed);
      } finally {
        await fx.db.database.query(
          `update clinic.clinics set auto_confirm_parent_bookings = false
            where id = $1`,
          [fx.clinicId],
        );
      }
    });

    it('writes an event in the same breath as the appointment', async () => {
      const session = await openSession();
      const appointment = await book(session);

      const events = await fx.db.database.query<{ event_type: string }>(
        `select event_type from clinic.appointment_events
          where appointment_id = $1`,
        [appointment.id],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(['created']);
    });

    it('hands back the existing appointment on a double-tap', async () => {
      // The same child, same session, twice. Not an error: a receptionist or a
      // parent pressed confirm twice.
      const session = await openSession();
      const first = await book(session);
      const second = await book(session);

      expect(second.id).toBe(first.id);
    });

    it('refuses a window that is not in the session', async () => {
      const session = await openSession();
      const stray = new Date(
        new Date(session.windowStart).getTime() + 7 * 60_000,
      ).toISOString();

      await expect(book({ ...session, windowStart: stray })).rejects.toMatchObject(
        { code: BookingErrorCode.SessionUnavailable },
      );
    });

    it('refuses a window that has already started', async () => {
      const session = await openSession({ startsInMinutes: -120 });
      await expect(book(session)).rejects.toMatchObject({
        code: BookingErrorCode.WindowInPast,
      });
    });

    it('refuses a closed session', async () => {
      const session = await openSession({ status: 'closed' });
      await expect(book(session)).rejects.toMatchObject({
        code: BookingErrorCode.SessionUnavailable,
      });
    });

    it('refuses a session belonging to another clinic', async () => {
      const foreign = await insertSession(fx.db.database, {
        clinicId: fx.otherClinicId,
        doctorMemberId: fx.otherDoctorMemberId,
      });
      await expect(book(foreign)).rejects.toMatchObject({
        code: BookingErrorCode.SessionUnavailable,
      });
    });

    it('reports the window full once every seat is held', async () => {
      const session = await openSession({ capacityPerWindow: 2 });
      await book(session);
      await book(session, {
        childId: await insertChild(fx.db.database, fx.clinicId, 'Second'),
      });

      await expect(
        book(session, {
          childId: await insertChild(fx.db.database, fx.clinicId, 'Third'),
        }),
      ).rejects.toMatchObject({ code: BookingErrorCode.SlotUnavailable });
    });

    it('lets a cancelled seat be booked again', async () => {
      // No counter to decrement: the partial index simply stops covering the
      // row, so the seat is free the moment the status changes.
      const session = await openSession({ capacityPerWindow: 1 });
      const first = await book(session);
      await service().transition(
        fx.clinicId,
        first.id,
        AppointmentStatus.Cancelled,
        { memberId: fx.doctorMemberId },
      );

      const replacement = await book(session, {
        childId: await insertChild(fx.db.database, fx.clinicId, 'Next'),
      });
      expect(replacement.id).not.toBe(first.id);
    });
  });

  describe('the capacity race', () => {
    it('gives exactly five of ten simultaneous bookings a seat', async () => {
      // This is the guarantee. Availability is advisory and always will be;
      // `appointments_seat_uq` is what actually decides, and nothing but a real
      // race proves it works.
      const session = await openSession({ capacityPerWindow: 5 });
      const children = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          insertChild(fx.db.database, fx.clinicId, `Racer ${index}`),
        ),
      );

      const service_ = service();
      const outcomes = await Promise.allSettled(
        children.map((childId) =>
          service_.create({
            clinicId: fx.clinicId,
            sessionId: session.id,
            windowStart: session.windowStart,
            childId,
            guardianId: fx.guardianId,
            visitType: VisitType.NewVisit,
          }),
        ),
      );

      const booked = outcomes.filter((o) => o.status === 'fulfilled');
      const refused = outcomes.filter((o) => o.status === 'rejected');

      expect(booked).toHaveLength(5);
      expect(refused).toHaveLength(5);

      // Every refusal is the honest one, not a leaked driver error.
      for (const outcome of refused) {
        expect((outcome as PromiseRejectedResult).reason).toMatchObject({
          code: BookingErrorCode.SlotUnavailable,
        });
      }

      // And the seats are 1..5 with no duplicates — the index held.
      const seats = await fx.db.database.query<{ seat_no: number }>(
        `select seat_no from clinic.appointments
          where session_id = $1 and status = 'requested'
          order by seat_no`,
        [session.id],
      );
      expect(seats.rows.map((r) => r.seat_no)).toEqual([1, 2, 3, 4, 5]);
    }, 30_000);
  });

  describe('the lifecycle', () => {
    it('walks the legal path from request to completion', async () => {
      const svc = service();
      const session = await openSession();
      const appointment = await book(session);
      const move = (to: AppointmentStatus) =>
        svc.transition(fx.clinicId, appointment.id, to, {
          memberId: fx.doctorMemberId,
        });

      expect((await move(AppointmentStatus.Confirmed)).status).toBe('confirmed');
      expect((await move(AppointmentStatus.CheckedIn)).status).toBe(
        'checked_in',
      );
      expect((await move(AppointmentStatus.Completed)).status).toBe('completed');
    });

    it.each([
      ['completed', AppointmentStatus.Completed, AppointmentStatus.Confirmed],
      ['cancelled', AppointmentStatus.Cancelled, AppointmentStatus.Confirmed],
      ['a no-show', AppointmentStatus.NoShow, AppointmentStatus.CheckedIn],
    ])('refuses to move %s appointments', async (_label, terminal, target) => {
      const svc = service();
      const session = await openSession();
      const appointment = await book(session);

      // Reach the terminal state by a legal route.
      await svc.transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Confirmed,
        { memberId: fx.doctorMemberId },
      );
      if (terminal === AppointmentStatus.Completed) {
        await svc.transition(
          fx.clinicId,
          appointment.id,
          AppointmentStatus.CheckedIn,
          { memberId: fx.doctorMemberId },
        );
      }
      await svc.transition(fx.clinicId, appointment.id, terminal, {
        memberId: fx.doctorMemberId,
      });

      await expect(
        svc.transition(fx.clinicId, appointment.id, target, {
          memberId: fx.doctorMemberId,
        }),
      ).rejects.toMatchObject({ code: BookingErrorCode.InvalidTransition });
    });

    it('refuses to check in something that was never confirmed', async () => {
      const session = await openSession();
      const appointment = await book(session);

      await expect(
        service().transition(
          fx.clinicId,
          appointment.id,
          AppointmentStatus.CheckedIn,
          { memberId: fx.doctorMemberId },
        ),
      ).rejects.toMatchObject({ code: BookingErrorCode.InvalidTransition });
    });

    it('treats a repeated transition as a no-op', async () => {
      const svc = service();
      const session = await openSession();
      const appointment = await book(session);

      await svc.transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Confirmed,
        { memberId: fx.doctorMemberId },
      );
      const again = await svc.transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Confirmed,
        { memberId: fx.doctorMemberId },
      );

      expect(again.status).toBe(AppointmentStatus.Confirmed);
    });

    it('records who cancelled, and why', async () => {
      const session = await openSession();
      const appointment = await book(session);

      const cancelled = await service().transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Cancelled,
        { memberId: fx.doctorMemberId, reason: 'الطبيبة مسافرة' },
      );

      // A rejection is a cancellation with a clinic author, not a status of
      // its own.
      expect(cancelled.cancelledBy).toBe('clinic');
      expect(cancelled.cancellationReason).toBe('الطبيبة مسافرة');
      expect(cancelled.cancelledAt).not.toBeNull();
    });

    it('attributes a parent’s cancellation to the parent', async () => {
      const session = await openSession();
      const appointment = await book(session);

      const cancelled = await service().transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Cancelled,
        { authUserId: '00000000-0000-0000-0000-000000000001' },
      );
      expect(cancelled.cancelledBy).toBe('parent');
    });

    it('refuses an appointment from another clinic', async () => {
      const session = await openSession();
      const appointment = await book(session);

      await expect(
        service().transition(
          fx.otherClinicId,
          appointment.id,
          AppointmentStatus.Confirmed,
          {},
        ),
      ).rejects.toMatchObject({ code: BookingErrorCode.AppointmentNotFound });
    });

    it('appends an event for every move', async () => {
      const svc = service();
      const session = await openSession();
      const appointment = await book(session);
      await svc.transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Confirmed,
        { memberId: fx.doctorMemberId },
      );

      const events = await fx.db.database.query<{
        event_type: string;
        from_status: string | null;
        to_status: string | null;
      }>(
        `select event_type, from_status, to_status
           from clinic.appointment_events
          where appointment_id = $1 order by created_at`,
        [appointment.id],
      );

      expect(events.rows).toEqual([
        { event_type: 'created', from_status: null, to_status: 'requested' },
        {
          event_type: 'confirmed',
          from_status: 'requested',
          to_status: 'confirmed',
        },
      ]);
    });
  });

  describe('a parent cancelling', () => {
    it('is allowed outside the clinic’s cutoff', async () => {
      // Cutoff is 120 minutes; the window is four hours out.
      const session = await openSession({ startsInMinutes: 240 });
      const appointment = await book(session);

      const cancelled = await service().cancelAsParent(
        fx.clinicId,
        appointment.id,
        { authUserId: '00000000-0000-0000-0000-000000000001' },
      );
      expect(cancelled.status).toBe(AppointmentStatus.Cancelled);
      expect(cancelled.cancelledBy).toBe('parent');
    });

    it('is refused inside it, with the cutoff so the screen can explain', async () => {
      const session = await openSession({ startsInMinutes: 30 });
      const appointment = await book(session);

      await expect(
        service().cancelAsParent(fx.clinicId, appointment.id, {}),
      ).rejects.toMatchObject({
        code: BookingErrorCode.CancellationTooLate,
        details: { cutoffMinutes: 120 },
      });
    });

    it('does not stop staff cancelling late', async () => {
      // Somebody has to be able to, when a parent phones five minutes before.
      const session = await openSession({ startsInMinutes: 30 });
      const appointment = await book(session);

      const cancelled = await service().transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Cancelled,
        { memberId: fx.doctorMemberId },
      );
      expect(cancelled.status).toBe(AppointmentStatus.Cancelled);
    });
  });

  describe('rescheduling', () => {
    it('moves the family and leaves a trail back', async () => {
      const session = await openSession();
      const later = await openSession({ startsInMinutes: 300 });
      const original = await book(session);

      const moved = await service().reschedule(
        fx.clinicId,
        original.id,
        { sessionId: later.id, windowStart: later.windowStart },
        { memberId: fx.doctorMemberId },
      );

      expect(moved.id).not.toBe(original.id);
      expect(moved.rescheduledFromAppointmentId).toBe(original.id);
      expect(moved.windowStart).toBe(later.windowStart);
      expect(moved.childId).toBe(original.childId);
    });

    it('releases the old seat, so exactly one appointment stays live', async () => {
      const session = await openSession();
      const later = await openSession({ startsInMinutes: 300 });
      const original = await book(session);

      await service().reschedule(
        fx.clinicId,
        original.id,
        { sessionId: later.id, windowStart: later.windowStart },
        { memberId: fx.doctorMemberId },
      );

      const live = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.appointments
          where child_id = $1
            and status in ('requested', 'confirmed', 'checked_in')`,
        [fx.childId],
      );
      expect(live.rows[0].count).toBe('1');
    });

    it('can move a family within the same window', async () => {
      // The commonest reschedule there is, and impossible if the old seat were
      // still held while the new one is claimed.
      const session = await openSession({ capacityPerWindow: 1 });
      const original = await book(session);

      const moved = await service().reschedule(
        fx.clinicId,
        original.id,
        { sessionId: session.id, windowStart: session.windowStart },
        { memberId: fx.doctorMemberId },
      );

      expect(moved.id).not.toBe(original.id);
      expect(moved.windowStart).toBe(session.windowStart);
    });

    it('leaves the original untouched when the target is unbookable', async () => {
      const session = await openSession();
      const original = await book(session);
      const closed = await openSession({
        startsInMinutes: 300,
        status: 'closed',
      });

      await expect(
        service().reschedule(
          fx.clinicId,
          original.id,
          { sessionId: closed.id, windowStart: closed.windowStart },
          { memberId: fx.doctorMemberId },
        ),
      ).rejects.toMatchObject({ code: BookingErrorCode.SessionUnavailable });

      // The whole thing is one transaction: a failed move must not have
      // cancelled the appointment the family still holds.
      const unchanged = await service().findById(fx.clinicId, original.id);
      expect(unchanged?.status).toBe(AppointmentStatus.Requested);
    });

    it('refuses to reschedule something already completed', async () => {
      const svc = service();
      const session = await openSession();
      const later = await openSession({ startsInMinutes: 300 });
      const appointment = await book(session);

      for (const to of [
        AppointmentStatus.Confirmed,
        AppointmentStatus.CheckedIn,
        AppointmentStatus.Completed,
      ]) {
        await svc.transition(fx.clinicId, appointment.id, to, {
          memberId: fx.doctorMemberId,
        });
      }

      await expect(
        svc.reschedule(
          fx.clinicId,
          appointment.id,
          { sessionId: later.id, windowStart: later.windowStart },
          { memberId: fx.doctorMemberId },
        ),
      ).rejects.toMatchObject({ code: BookingErrorCode.InvalidTransition });
    });
  });

  describe('reading', () => {
    it('separates a guardian’s upcoming visits from their past ones', async () => {
      const svc = service();
      const session = await openSession();
      const upcoming = await book(session);

      const past = await openSession({ startsInMinutes: 300 });
      const finished = await book(past, { childId: fx.siblingId });
      for (const to of [
        AppointmentStatus.Confirmed,
        AppointmentStatus.CheckedIn,
        AppointmentStatus.Completed,
      ]) {
        await svc.transition(fx.clinicId, finished.id, to, {
          memberId: fx.doctorMemberId,
        });
      }

      const ahead = await svc.listForGuardian(
        fx.clinicId,
        fx.guardianId,
        'upcoming',
      );
      const behind = await svc.listForGuardian(
        fx.clinicId,
        fx.guardianId,
        'past',
      );

      expect(ahead.map((a) => a.id)).toEqual([upcoming.id]);
      expect(behind.map((a) => a.id)).toEqual([finished.id]);
    });

    it('does not show one guardian another’s appointments', async () => {
      const session = await openSession();
      await book(session);

      const foreign = await service().listForGuardian(
        fx.clinicId,
        fx.otherGuardianId,
        'upcoming',
      );
      expect(foreign).toEqual([]);
    });

    it('lists a clinic day in window order', async () => {
      const session = await openSession();
      const first = await book(session);
      const second = await book(session, { childId: fx.siblingId });

      const day = await fx.db.database.query<{ session_date: string }>(
        `select session_date::text as session_date
           from clinic.clinic_sessions where id = $1`,
        [session.id],
      );

      const listed = await service().listForDay(
        fx.clinicId,
        day.rows[0].session_date,
      );
      expect(listed.map((a) => a.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
    });
  });

  describe('check-in eligibility', () => {
    it('locks and returns a confirmed appointment', async () => {
      const svc = service();
      const session = await openSession();
      const appointment = await book(session);
      await svc.transition(
        fx.clinicId,
        appointment.id,
        AppointmentStatus.Confirmed,
        { memberId: fx.doctorMemberId },
      );

      const locked = await fx.db.database.transaction((tx) =>
        svc.findForCheckIn(fx.clinicId, appointment.id, tx),
      );
      expect(locked.id).toBe(appointment.id);
    });

    it('refuses one that is still only requested', async () => {
      const svc = service();
      const session = await openSession();
      const appointment = await book(session);

      await expect(
        fx.db.database.transaction((tx) =>
          svc.findForCheckIn(fx.clinicId, appointment.id, tx),
        ),
      ).rejects.toMatchObject({ code: BookingErrorCode.InvalidTransition });
    });
  });
});

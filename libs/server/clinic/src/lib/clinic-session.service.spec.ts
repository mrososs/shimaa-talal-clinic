import { ClinicSessionStatus, DoctorPresence } from '@clinic/contracts';
import { ClinicSessionService } from './clinic-session.service';
import { ClinicErrorCode } from './clinic.errors';
import {
  describeWithDatabase,
  insertSchedule,
  weekdayOf,
} from './clinic.fixture';

/**
 * The operational day, against a real server.
 *
 * Two properties carry the weight. Materialisation has to be idempotent under
 * concurrency, because two parents opening the booking screen at the same
 * moment both trigger it. And "today" has to be the clinic's day rather than
 * the server's — a fact that is invisible in Cairo for most of the day and
 * wrong for ten hours a day in Kiritimati.
 */
describeWithDatabase('clinic sessions', (fx) => {
  const sessions = () => new ClinicSessionService(fx.db.database);

  /** A date far enough out that no other suite has materialised it. */
  const DATE = '2030-03-12'; // A Tuesday.
  let tuesday: number;

  beforeAll(async () => {
    tuesday = await weekdayOf(fx.db.database, DATE);
  });

  afterEach(async () => {
    await fx.db.database.query(
      `delete from clinic.clinic_sessions where clinic_id = any($1)`,
      [[fx.clinicId, fx.otherClinicId, fx.farEastClinicId]],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_schedules where clinic_id = any($1)`,
      [[fx.clinicId, fx.otherClinicId, fx.farEastClinicId]],
    );
  });

  describe('materialising a day', () => {
    it('creates one session per schedule that applies', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        startsAt: '10:00',
        endsAt: '16:00',
      });

      const created = await sessions().ensureForDate(fx.clinicId, DATE);

      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        sessionDate: DATE,
        sessionKind: 'morning',
        windowMinutes: 60,
        capacityPerWindow: 5,
        status: ClinicSessionStatus.Scheduled,
        doctorPresence: DoctorPresence.Expected,
        revision: 0,
      });
      // Seeded from the clinic, not from a constant in code.
      expect(created[0].avgConsultMinutes).toBe(6);
    });

    it('creates nothing on a day the clinic does not run', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: (tuesday + 1) % 7,
      });

      expect(await sessions().ensureForDate(fx.clinicId, DATE)).toEqual([]);
    });

    it('is idempotent — a second call adds nothing', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
      });

      const first = await sessions().ensureForDate(fx.clinicId, DATE);
      const second = await sessions().ensureForDate(fx.clinicId, DATE);

      expect(second).toHaveLength(1);
      expect(second[0].id).toBe(first[0].id);
    });

    it('survives ten simultaneous callers with one session', async () => {
      // Two parents opening the booking screen at the same moment both run
      // this. The unique index is what makes the losers harmless; a
      // check-then-insert would produce a duplicate day.
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
      });

      const service = sessions();
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          service.ensureForDate(fx.clinicId, DATE),
        ),
      );

      const ids = new Set(results.flat().map((session) => session.id));
      expect(ids.size).toBe(1);

      const rows = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.clinic_sessions
          where clinic_id = $1 and session_date = $2::date`,
        [fx.clinicId, DATE],
      );
      expect(rows.rows[0].count).toBe('1');
    });

    it('honours the newest schedule when one supersedes another', async () => {
      // Schedules are superseded by dating them, never deleted: appointments
      // booked against the old shape must stay explicable.
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        capacityPerWindow: 4,
        effectiveFrom: '2000-01-01',
      });
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        capacityPerWindow: 9,
        effectiveFrom: '2029-01-01',
      });

      const created = await sessions().ensureForDate(fx.clinicId, DATE);

      expect(created).toHaveLength(1);
      expect(created[0].capacityPerWindow).toBe(9);
    });

    it('ignores a schedule that has not started or has ended', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        effectiveFrom: '2031-01-01',
      });
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        sessionKind: 'evening',
        startsAt: '17:00',
        endsAt: '20:00',
        effectiveFrom: '2000-01-01',
        effectiveTo: '2020-01-01',
      });

      expect(await sessions().ensureForDate(fx.clinicId, DATE)).toEqual([]);
    });

    it('ignores an inactive schedule', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        active: false,
      });

      expect(await sessions().ensureForDate(fx.clinicId, DATE)).toEqual([]);
    });

    it('creates a morning and an evening session separately', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        sessionKind: 'morning',
        startsAt: '10:00',
        endsAt: '13:00',
      });
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        sessionKind: 'evening',
        startsAt: '17:00',
        endsAt: '20:00',
      });

      const created = await sessions().ensureForDate(fx.clinicId, DATE);

      expect(created.map((s) => s.sessionKind)).toEqual(['morning', 'evening']);
      // Ordered by when they actually run, which is what a day view needs.
      expect(created[0].plannedStart < created[1].plannedStart).toBe(true);
    });

    it('does not materialise another clinic’s schedule', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.otherClinicId,
        doctorMemberId: fx.otherDoctorMemberId,
        weekday: tuesday,
      });

      expect(await sessions().ensureForDate(fx.clinicId, DATE)).toEqual([]);
    });
  });

  describe('the clinic’s own clock', () => {
    it('resolves wall-clock times against the clinic’s timezone', async () => {
      // 10:00 in Cairo on 2030-03-12 is 08:00 UTC (EET, UTC+2).
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        startsAt: '10:00',
        endsAt: '16:00',
      });

      const [session] = await sessions().ensureForDate(fx.clinicId, DATE);

      expect(session.plannedStart).toBe('2030-03-12T08:00:00.000Z');
      expect(session.plannedEnd).toBe('2030-03-12T14:00:00.000Z');
    });

    it('resolves them against a very different timezone too', async () => {
      // Kiritimati is UTC+14, so 10:00 local is 20:00 UTC the *previous* day.
      // A server that used its own clock would produce the same instant here as
      // it did for Cairo, which is the whole point of checking two zones.
      await insertSchedule(fx.db.database, {
        clinicId: fx.farEastClinicId,
        doctorMemberId: fx.farEastDoctorMemberId,
        weekday: tuesday,
        startsAt: '10:00',
        endsAt: '16:00',
      });

      const [session] = await sessions().ensureForDate(fx.farEastClinicId, DATE);

      expect(session.plannedStart).toBe('2030-03-11T20:00:00.000Z');
      expect(session.plannedEnd).toBe('2030-03-12T02:00:00.000Z');
      // The session still belongs to the clinic's own calendar day.
      expect(session.sessionDate).toBe(DATE);
    });

    it('reports the session date as the clinic wrote it', async () => {
      // node-postgres would parse a bare `date` at the host's midnight, which
      // is a different calendar day whenever the zones disagree.
      await insertSchedule(fx.db.database, {
        clinicId: fx.farEastClinicId,
        doctorMemberId: fx.farEastDoctorMemberId,
        weekday: tuesday,
      });

      const [session] = await sessions().ensureForDate(fx.farEastClinicId, DATE);
      expect(session.sessionDate).toBe(DATE);
      expect(typeof session.sessionDate).toBe('string');
    });
  });

  describe('operational state', () => {
    async function materialise() {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
      });
      const [session] = await sessions().ensureForDate(fx.clinicId, DATE);
      return session;
    }

    it('opens, pauses, resumes and closes', async () => {
      const service = sessions();
      const session = await materialise();

      expect((await service.open(fx.clinicId, session.id)).status).toBe('open');
      expect((await service.pause(fx.clinicId, session.id)).status).toBe(
        'paused',
      );
      expect((await service.resume(fx.clinicId, session.id)).status).toBe(
        'open',
      );
      expect((await service.close(fx.clinicId, session.id)).status).toBe(
        'closed',
      );
    });

    it('treats a repeated command as a no-op, not an error', async () => {
      // Two receptionists pressing "open" at the same moment is not a failure.
      const service = sessions();
      const session = await materialise();

      await service.open(fx.clinicId, session.id);
      const again = await service.open(fx.clinicId, session.id);

      expect(again.status).toBe('open');
    });

    it('does not move opened_at when a paused session reopens', async () => {
      const service = sessions();
      const session = await materialise();

      await service.open(fx.clinicId, session.id);
      const first = await openedAt(session.id);

      await service.pause(fx.clinicId, session.id);
      await service.open(fx.clinicId, session.id);

      // A pause in the middle of the morning must not rewrite when the
      // morning began.
      expect(await openedAt(session.id)).toEqual(first);
    });

    it('refuses to reopen a closed session', async () => {
      // Closing is final: reopening would resurrect a queue staff deliberately
      // emptied, and those patients were told to go home.
      const service = sessions();
      const session = await materialise();

      await service.close(fx.clinicId, session.id);

      await expect(service.open(fx.clinicId, session.id)).rejects.toMatchObject(
        { code: ClinicErrorCode.SessionClosed },
      );
    });

    it('closes an already-closed session without complaining', async () => {
      const service = sessions();
      const session = await materialise();

      await service.close(fx.clinicId, session.id);
      expect((await service.close(fx.clinicId, session.id)).status).toBe(
        'closed',
      );
    });

    it('refuses a session belonging to another clinic', async () => {
      const service = sessions();
      const session = await materialise();

      await expect(
        service.open(fx.otherClinicId, session.id),
      ).rejects.toMatchObject({ code: ClinicErrorCode.SessionNotFound });
    });
  });

  describe('doctor presence and pace', () => {
    async function materialise() {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
      });
      const [session] = await sessions().ensureForDate(fx.clinicId, DATE);
      return session;
    }

    it('records a delay with a note', async () => {
      const session = await materialise();

      const updated = await sessions().setDoctorPresence(
        fx.clinicId,
        session.id,
        {
          presence: DoctorPresence.EnRoute,
          delayMinutes: 20,
          note: 'في الطريق',
        },
      );

      expect(updated).toMatchObject({
        doctorPresence: 'en_route',
        delayMinutes: 20,
        delayNote: 'في الطريق',
      });
    });

    it('clears the delay once the doctor has arrived', async () => {
      // Leaving a stale "20 minutes late" on an arrived doctor is worse than
      // saying nothing.
      const service = sessions();
      const session = await materialise();

      await service.setDoctorPresence(fx.clinicId, session.id, {
        presence: DoctorPresence.EnRoute,
        delayMinutes: 20,
        note: 'في الطريق',
      });
      const arrived = await service.setDoctorPresence(fx.clinicId, session.id, {
        presence: DoctorPresence.Arrived,
      });

      expect(arrived.delayMinutes).toBeNull();
      expect(arrived.delayNote).toBeNull();
    });

    it('adjusts the pace estimate', async () => {
      const session = await materialise();
      const updated = await sessions().setPace(fx.clinicId, session.id, 9);
      expect(updated.avgConsultMinutes).toBe(9);
    });

    it('refuses presence and pace for another clinic', async () => {
      const service = sessions();
      const session = await materialise();

      await expect(
        service.setPace(fx.otherClinicId, session.id, 9),
      ).rejects.toMatchObject({ code: ClinicErrorCode.SessionNotFound });
      await expect(
        service.setDoctorPresence(fx.otherClinicId, session.id, {
          presence: DoctorPresence.Arrived,
        }),
      ).rejects.toMatchObject({ code: ClinicErrorCode.SessionNotFound });
    });
  });

  describe('revision', () => {
    it('increments so a poll can be told nothing changed', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
      });
      const service = sessions();
      const [session] = await service.ensureForDate(fx.clinicId, DATE);

      expect(session.revision).toBe(0);
      expect(await service.bumpRevision(session.id)).toBe(1);
      expect(await service.bumpRevision(session.id)).toBe(2);

      const reread = await service.findById(fx.clinicId, session.id);
      expect(reread?.revision).toBe(2);
    });
  });

  describe('the row lock', () => {
    it('serialises two transactions against the same session', async () => {
      // This lock is the concurrency root for the entire queue. If it does not
      // actually serialise, every guarantee built on it is decoration.
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
      });
      const service = sessions();
      const [session] = await service.ensureForDate(fx.clinicId, DATE);

      const order: string[] = [];

      // Signalled rather than slept for: the first transaction announces when
      // it actually holds the lock. Guessing with a timer makes the test a
      // measure of network latency, which against a hosted server it will
      // eventually lose.
      let announceLocked: () => void = () => undefined;
      const firstHasLock = new Promise<void>((resolve) => {
        announceLocked = resolve;
      });
      let releaseFirst: () => void = () => undefined;
      const firstMayRelease = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      const first = fx.db.database.transaction(async (tx) => {
        await service.lockForUpdate(fx.clinicId, session.id, tx);
        order.push('first-locked');
        announceLocked();
        await firstMayRelease;
      });

      await firstHasLock;

      let secondFinished = false;
      const second = fx.db.database
        .transaction(async (tx) => {
          await service.lockForUpdate(fx.clinicId, session.id, tx);
          order.push('second-locked');
        })
        .then(() => {
          secondFinished = true;
        });

      // A generous window: if the lock did nothing, the second transaction
      // would have finished many times over within this.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(secondFinished).toBe(false);
      expect(order).toEqual(['first-locked']);

      releaseFirst();
      await Promise.all([first, second]);

      expect(order).toEqual(['first-locked', 'second-locked']);
    }, 30_000);

    it('reports a missing session rather than locking nothing', async () => {
      await expect(
        fx.db.database.transaction((tx) =>
          sessions().lockForUpdate(
            fx.clinicId,
            '00000000-0000-0000-0000-000000000000',
            tx,
          ),
        ),
      ).rejects.toMatchObject({ code: ClinicErrorCode.SessionNotFound });
    });
  });

  async function openedAt(sessionId: string): Promise<Date | null> {
    const row = await fx.db.database.query<{ opened_at: Date | null }>(
      `select opened_at from clinic.clinic_sessions where id = $1`,
      [sessionId],
    );
    return row.rows[0]?.opened_at ?? null;
  }
});

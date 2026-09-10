import { ClinicService, ClinicSessionService } from '@clinic/server-clinic';
import { QueueStatus } from '@clinic/contracts';
import { QueueCommandService } from './queue-command.service';
import { QueueEntryService } from './queue-entry.service';
import { QueueErrorCode } from './queue.errors';
import {
  describeWithDatabase,
  insertChild,
  insertSession,
} from './queue.fixture';

/**
 * The live queue, against a real server.
 *
 * The tests that matter are the races. Whether a status column changes when you
 * update it could be reasoned about; whether two receptionists pressing Call
 * Next at the same instant can produce two called patients cannot, and that is
 * the guarantee the whole board rests on.
 */
describeWithDatabase('queue', (fx) => {
  const entries = () => new QueueEntryService(fx.db.database);
  const commands = () =>
    new QueueCommandService(
      fx.db.database,
      new QueueEntryService(fx.db.database),
      new ClinicSessionService(fx.db.database),
      new ClinicService(fx.db.database),
    );

  let sessionId: string;
  let childCounter = 0;

  const child = () => {
    childCounter += 1;
    return insertChild(fx.db.database, fx.clinicId, `Child ${childCounter}`);
  };

  /** Put someone in the queue and hand back their entry. */
  const admit = async (childId?: string) =>
    commands().admit(
      {
        clinicId: fx.clinicId,
        sessionId,
        childId: childId ?? (await child()),
        guardianId: fx.guardianId,
      },
      { memberId: fx.doctorMemberId },
    );

  beforeEach(async () => {
    sessionId = await insertSession(fx.db.database, {
      clinicId: fx.clinicId,
      doctorMemberId: fx.doctorMemberId,
    });
  });

  afterEach(async () => {
    const clinics = [fx.clinicId, fx.otherClinicId];
    await fx.db.database.query(
      `delete from clinic.queue_events
        where entry_id in (
          select id from clinic.queue_entries where clinic_id = any($1))`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.queue_entries where clinic_id = any($1)`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_sessions where clinic_id = any($1)`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.children where clinic_id = any($1)`,
      [clinics],
    );
  });

  describe('arriving', () => {
    it('gives the first patient ticket one, waiting', async () => {
      const entry = await admit();

      expect(entry).toMatchObject({
        ticketNumber: 1,
        status: QueueStatus.Waiting,
        source: 'walk_in',
        isEmergency: false,
        deferCount: 0,
      });
    });

    it('numbers patients in the order they arrive', async () => {
      const first = await admit();
      const second = await admit();
      const third = await admit();

      expect([first, second, third].map((e) => e.ticketNumber)).toEqual([
        1, 2, 3,
      ]);
    });

    it('writes one event per arrival', async () => {
      const entry = await admit();
      const events = await fx.db.database.query<{ event_type: string }>(
        `select event_type from clinic.queue_events where entry_id = $1`,
        [entry.id],
      );
      expect(events.rows.map((r) => r.event_type)).toEqual(['checked_in']);
    });

    it('refuses to admit anyone to a paused queue', async () => {
      const paused = await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        status: 'paused',
        // A second session for one doctor on one day needs the other half:
        // clinic_sessions_day_uq allows morning and evening, not two mornings.
        kind: 'evening',
      });

      await expect(
        commands().admit(
          {
            clinicId: fx.clinicId,
            sessionId: paused,
            childId: await child(),
          },
          { memberId: fx.doctorMemberId },
        ),
      ).rejects.toMatchObject({ code: QueueErrorCode.SessionNotRunning });
    });

    it('bumps the revision so a poll knows to re-read', async () => {
      const sessions = new ClinicSessionService(fx.db.database);
      const before = await sessions.findById(fx.clinicId, sessionId);
      await admit();
      const after = await sessions.findById(fx.clinicId, sessionId);

      expect(after?.revision).toBeGreaterThan(before?.revision ?? 0);
    });
  });

  describe('the ticket race', () => {
    it('gives ten simultaneous arrivals ten distinct numbers', async () => {
      // The session's row lock is what makes this true. Without it, two
      // check-ins read the same "next number" and both take it.
      const kids = await Promise.all(Array.from({ length: 10 }, () => child()));
      const service = commands();

      const admitted = await Promise.all(
        kids.map((childId) =>
          service.admit(
            { clinicId: fx.clinicId, sessionId, childId },
            { memberId: fx.doctorMemberId },
          ),
        ),
      );

      const numbers = admitted.map((e) => e.ticketNumber).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }, 30_000);
  });

  describe('serving', () => {
    it('walks a patient from waiting to done', async () => {
      const service = commands();
      const entry = await admit();

      const called = await service.callNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });
      expect(called.called?.id).toBe(entry.id);
      expect(called.called?.status).toBe(QueueStatus.Called);
      // Called means a deadline exists — the grace rule depends on it.
      expect(called.called?.graceExpiresAt).not.toBeNull();

      const started = await service.start(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      expect(started.status).toBe(QueueStatus.InService);
      expect(started.graceExpiresAt).toBeNull();

      const done = await service.complete(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      expect(done.status).toBe(QueueStatus.Done);
      expect(done.completedAt).not.toBeNull();
    });

    it('refuses call-next while a patient is still in service', async () => {
      const service = commands();
      const first = await admit();
      const second = await admit();

      await service.callNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, first.id, {
        memberId: fx.doctorMemberId,
      });

      const sessionBefore = await new ClinicSessionService(
        fx.db.database,
      ).findById(fx.clinicId, sessionId);
      await expect(
        service.callNext(fx.clinicId, sessionId, {
          memberId: fx.doctorMemberId,
        }),
      ).rejects.toMatchObject({
        code: QueueErrorCode.CurrentPatientStillInService,
      });

      const previous = await entries().findById(fx.clinicId, first.id);
      const waiting = await entries().findById(fx.clinicId, second.id);
      const sessionAfter = await new ClinicSessionService(
        fx.db.database,
      ).findById(fx.clinicId, sessionId);
      expect(previous?.status).toBe(QueueStatus.InService);
      expect(waiting?.status).toBe(QueueStatus.Waiting);
      expect(sessionAfter?.revision).toBe(sessionBefore?.revision);
    });

    it('completes the current patient and calls next only via the explicit command', async () => {
      const service = commands();
      const first = await admit();
      const second = await admit();

      await service.callNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, first.id, {
        memberId: fx.doctorMemberId,
      });
      const result = await service.completeAndCallNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });

      expect(result.completed?.id).toBe(first.id);
      expect(result.called?.id).toBe(second.id);
      expect((await entries().findById(fx.clinicId, first.id))?.status).toBe(
        QueueStatus.Done,
      );
    });

    it('returns an empty successful result when nobody is waiting', async () => {
      await expect(
        commands().callNext(fx.clinicId, sessionId, {
          memberId: fx.doctorMemberId,
        }),
      ).resolves.toEqual({ completed: null, missed: null, called: null });
    });

    it('resolves only an expired called patient before calling another', async () => {
      const service = commands();
      const first = await admit();
      const second = await admit();
      await service.callNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });
      await expect(
        service.callNext(fx.clinicId, sessionId, {
          memberId: fx.doctorMemberId,
        }),
      ).rejects.toMatchObject({ code: QueueErrorCode.GraceNotExpired });

      await fx.db.database.query(
        `update clinic.queue_entries
            set grace_expires_at = now() - interval '1 minute'
          where id = $1`,
        [first.id],
      );
      const result = await service.callNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });
      expect(result.missed?.id).toBe(first.id);
      expect(result.called?.id).toBe(second.id);
    });

    it('treats a repeated command as a no-op', async () => {
      const service = commands();
      const entry = await admit();
      await service.callNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });

      const again = await service.start(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      expect(again.status).toBe(QueueStatus.InService);
    });

    it('does not record or bump a repeated completion', async () => {
      const service = commands();
      const entry = await admit();
      await service.call(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      await service.complete(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      const sessions = new ClinicSessionService(fx.db.database);
      const before = await sessions.findById(fx.clinicId, sessionId);

      const again = await service.complete(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });

      const after = await sessions.findById(fx.clinicId, sessionId);
      const events = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_events
          where entry_id = $1 and event_type = 'completed'`,
        [entry.id],
      );
      expect(again.status).toBe(QueueStatus.Done);
      expect(after?.revision).toBe(before?.revision);
      expect(events.rows[0].count).toBe('1');
    });

    it('refuses a move the state machine forbids', async () => {
      const entry = await admit();
      await expect(
        commands().start(fx.clinicId, entry.id, {
          memberId: fx.doctorMemberId,
        }),
      ).rejects.toMatchObject({ code: QueueErrorCode.InvalidTransition });
    });
  });

  describe('paused means a full queue freeze', () => {
    it.each([
      'admit',
      'callNext',
      'completeAndCallNext',
      'call',
      'start',
      'complete',
      'miss',
      'requeue',
      'cancel',
      'emergency',
      'move',
      'defer',
    ])('rejects %s without an event or revision bump', async (command) => {
      const service = commands();
      const current = await admit();
      const called = await admit();
      const missed = await admit();
      const waiting = await admit();
      const neighbour = await admit();

      await service.call(fx.clinicId, current.id, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, current.id, {
        memberId: fx.doctorMemberId,
      });
      await service.call(fx.clinicId, missed.id, {
        memberId: fx.doctorMemberId,
      });
      await service.miss(fx.clinicId, missed.id, {
        memberId: fx.doctorMemberId,
        force: true,
        reason: 'setup',
      });
      await service.call(fx.clinicId, called.id, {
        memberId: fx.doctorMemberId,
      });
      await fx.db.database.query(
        `update clinic.clinic_sessions set status = 'paused' where id = $1`,
        [sessionId],
      );

      const sessions = new ClinicSessionService(fx.db.database);
      const before = await sessions.findById(fx.clinicId, sessionId);
      const eventsBefore = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_events
          where session_id = $1`,
        [sessionId],
      );
      const actions: Record<string, () => Promise<unknown>> = {
        admit: () =>
          service.admit(
            {
              clinicId: fx.clinicId,
              sessionId,
              childId: current.childId,
            },
            { memberId: fx.doctorMemberId },
          ),
        callNext: () =>
          service.callNext(fx.clinicId, sessionId, {
            memberId: fx.doctorMemberId,
          }),
        completeAndCallNext: () =>
          service.completeAndCallNext(fx.clinicId, sessionId, {
            memberId: fx.doctorMemberId,
          }),
        call: () =>
          service.call(fx.clinicId, waiting.id, {
            memberId: fx.doctorMemberId,
          }),
        start: () =>
          service.start(fx.clinicId, called.id, {
            memberId: fx.doctorMemberId,
          }),
        complete: () =>
          service.complete(fx.clinicId, current.id, {
            memberId: fx.doctorMemberId,
          }),
        miss: () =>
          service.miss(fx.clinicId, called.id, {
            memberId: fx.doctorMemberId,
            force: true,
            reason: 'paused',
          }),
        requeue: () =>
          service.requeue(fx.clinicId, missed.id, {
            memberId: fx.doctorMemberId,
          }),
        cancel: () =>
          service.cancel(fx.clinicId, waiting.id, {
            memberId: fx.doctorMemberId,
          }),
        emergency: () =>
          service.setEmergency(fx.clinicId, waiting.id, true, {
            memberId: fx.doctorMemberId,
            reason: 'paused',
          }),
        move: () =>
          service.move(
            fx.clinicId,
            waiting.id,
            { afterEntryId: neighbour.id },
            { memberId: fx.doctorMemberId },
          ),
        defer: () =>
          service.defer(fx.clinicId, waiting.id, {
            authUserId: '00000000-0000-0000-0000-000000000001',
          }),
      };

      await expect(actions[command]()).rejects.toMatchObject({
        code: QueueErrorCode.SessionNotRunning,
      });
      const after = await sessions.findById(fx.clinicId, sessionId);
      const eventsAfter = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_events
          where session_id = $1`,
        [sessionId],
      );
      expect(after?.revision).toBe(before?.revision);
      expect(eventsAfter.rows[0].count).toBe(eventsBefore.rows[0].count);
    });
  });

  describe('the call-next race', () => {
    it('never produces two called patients', async () => {
      // This is the guarantee. Two receptionists, same instant, one queue.
      await admit();
      await admit();
      await admit();
      const service = commands();

      const outcomes = await Promise.allSettled([
        service.callNext(fx.clinicId, sessionId, {
          memberId: fx.doctorMemberId,
        }),
        service.callNext(fx.clinicId, sessionId, {
          memberId: fx.doctorMemberId,
        }),
      ]);

      const called = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_entries
          where session_id = $1 and status = 'called'`,
        [sessionId],
      );
      expect(called.rows[0].count).toBe('1');

      // The session lock permits one call. The second sees the still-valid
      // called patient and is refused rather than skipping them early.
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      for (const outcome of rejected) {
        expect((outcome as PromiseRejectedResult).reason).toMatchObject({
          code: expect.stringMatching(/queue_/),
        });
      }
    }, 30_000);

    it('serializes two complete-and-call-next requests', async () => {
      const service = commands();
      const current = await admit();
      await admit();
      await admit();
      await service.callNext(fx.clinicId, sessionId, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, current.id, {
        memberId: fx.doctorMemberId,
      });

      const sessions = new ClinicSessionService(fx.db.database);
      const before = await sessions.findById(fx.clinicId, sessionId);
      const outcomes = await Promise.allSettled([
        service.completeAndCallNext(fx.clinicId, sessionId, {
          memberId: fx.doctorMemberId,
        }),
        service.completeAndCallNext(fx.clinicId, sessionId, {
          memberId: fx.doctorMemberId,
        }),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      const counts = await fx.db.database.query<{
        called: string;
        completed_events: string;
      }>(
        `select
           count(*) filter (where status = 'called')::text as called,
           (select count(*)::text from clinic.queue_events
             where entry_id = $2 and event_type = 'completed') as completed_events
         from clinic.queue_entries where session_id = $1`,
        [sessionId, current.id],
      );
      const after = await sessions.findById(fx.clinicId, sessionId);
      expect(counts.rows[0]).toEqual({ called: '1', completed_events: '1' });
      expect(after?.revision).toBe((before?.revision ?? 0) + 1);
    }, 30_000);

    it('never produces two patients in service', async () => {
      const service = commands();
      const first = await admit();
      const second = await admit();

      await service.call(fx.clinicId, first.id, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, first.id, {
        memberId: fx.doctorMemberId,
      });
      await service.call(fx.clinicId, second.id, {
        memberId: fx.doctorMemberId,
      });

      await expect(
        service.start(fx.clinicId, second.id, {
          memberId: fx.doctorMemberId,
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/queue_/) });

      const inService = await fx.db.database.query<{ count: string }>(
        `select count(*)::text as count from clinic.queue_entries
          where session_id = $1 and status = 'in_service'`,
        [sessionId],
      );
      expect(inService.rows[0].count).toBe('1');
    });
  });

  describe('grace and missed turns', () => {
    it('refuses to skip a patient whose grace is still running', async () => {
      const service = commands();
      const entry = await admit();
      await service.call(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });

      await expect(
        service.miss(fx.clinicId, entry.id, { memberId: fx.doctorMemberId }),
      ).rejects.toMatchObject({ code: QueueErrorCode.GraceNotExpired });
    });

    it('allows an early skip with a reason', async () => {
      const service = commands();
      const entry = await admit();
      await service.call(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });

      const missed = await service.miss(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
        force: true,
        reason: 'اتصلت الأم وقالت إنها لن تحضر',
      });
      expect(missed.status).toBe(QueueStatus.Missed);
    });

    it('allows a skip once the deadline has passed', async () => {
      const service = commands();
      const entry = await admit();
      await service.call(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });

      // Reach into the past rather than sleep for ten minutes.
      await fx.db.database.query(
        `update clinic.queue_entries
            set grace_expires_at = now() - interval '1 minute'
          where id = $1`,
        [entry.id],
      );

      const missed = await service.miss(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      expect(missed.status).toBe(QueueStatus.Missed);
    });

    it('requeues with a new number, at the back', async () => {
      const service = commands();
      const late = await admit();
      await admit();
      await admit();

      await service.call(fx.clinicId, late.id, {
        memberId: fx.doctorMemberId,
      });
      await service.miss(fx.clinicId, late.id, {
        memberId: fx.doctorMemberId,
        force: true,
        reason: 'لم يحضر',
      });

      const back = await service.requeue(fx.clinicId, late.id, {
        memberId: fx.doctorMemberId,
      });

      expect(back.status).toBe(QueueStatus.Waiting);
      // A new number, because they genuinely lost their place.
      expect(back.ticketNumber).toBeGreaterThan(late.ticketNumber);

      const order = await entries().listActive(sessionId);
      expect(order.at(-1)?.id).toBe(late.id);
    });

    it('refuses to requeue somebody who is not missed', async () => {
      const entry = await admit();
      await expect(
        commands().requeue(fx.clinicId, entry.id, {
          memberId: fx.doctorMemberId,
        }),
      ).rejects.toMatchObject({ code: QueueErrorCode.InvalidTransition });
    });
  });

  describe('emergency', () => {
    it('moves ahead of everyone waiting, without touching their numbers', async () => {
      const service = commands();
      const first = await admit();
      const second = await admit();
      const urgent = await admit();

      const marked = await service.setEmergency(fx.clinicId, urgent.id, true, {
        memberId: fx.doctorMemberId,
        reason: 'صعوبة في التنفس',
      });

      expect(marked.isEmergency).toBe(true);
      // Ticket numbers are untouched — that is the whole point of separating
      // them from the sort key.
      expect(marked.ticketNumber).toBe(urgent.ticketNumber);

      const order = await entries().listActive(sessionId);
      expect(order.map((e) => e.id)).toEqual([urgent.id, first.id, second.id]);
    });

    it('does not interrupt the patient already with the doctor', async () => {
      const service = commands();
      const inRoom = await admit();
      const urgent = await admit();

      await service.call(fx.clinicId, inRoom.id, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, inRoom.id, {
        memberId: fx.doctorMemberId,
      });

      await service.setEmergency(fx.clinicId, urgent.id, true, {
        memberId: fx.doctorMemberId,
        reason: 'حالة عاجلة',
      });

      // The emergency sorts first, but the consultation in progress is
      // untouched — nobody is pulled out of the room.
      const stillIn = await entries().findById(fx.clinicId, inRoom.id);
      expect(stillIn?.status).toBe(QueueStatus.InService);
    });

    it('refuses an emergency with no reason', async () => {
      const entry = await admit();
      await expect(
        commands().setEmergency(fx.clinicId, entry.id, true, {
          memberId: fx.doctorMemberId,
        }),
      ).rejects.toMatchObject({ code: QueueErrorCode.ReasonRequired });
    });

    it('can be undone', async () => {
      const service = commands();
      const entry = await admit();
      await service.setEmergency(fx.clinicId, entry.id, true, {
        memberId: fx.doctorMemberId,
        reason: 'خطأ',
      });

      const cleared = await service.setEmergency(fx.clinicId, entry.id, false, {
        memberId: fx.doctorMemberId,
      });
      expect(cleared.isEmergency).toBe(false);
    });

    it('records both the reason and who marked it', async () => {
      const service = commands();
      const entry = await admit();
      await service.setEmergency(fx.clinicId, entry.id, true, {
        memberId: fx.doctorMemberId,
        reason: 'ارتفاع الحرارة',
      });

      const row = await fx.db.database.query<{
        emergency_reason: string;
        emergency_marked_by: string;
      }>(
        `select emergency_reason, emergency_marked_by
           from clinic.queue_entries where id = $1`,
        [entry.id],
      );
      expect(row.rows[0]).toMatchObject({
        emergency_reason: 'ارتفاع الحرارة',
        emergency_marked_by: fx.doctorMemberId,
      });
    });
  });

  describe('patients ahead', () => {
    it('counts, rather than subtracting ticket numbers', async () => {
      const service = commands();
      const first = await admit();
      const second = await admit();
      const third = await admit();

      expect(await entries().aheadCount(third.id)).toBe(2);

      // An emergency jumps the queue. `myNumber - nowServing` would still say
      // two; the count says three, which is the truth.
      await service.setEmergency(fx.clinicId, second.id, true, {
        memberId: fx.doctorMemberId,
        reason: 'عاجل',
      });
      expect(await entries().aheadCount(third.id)).toBe(2);
      expect(await entries().aheadCount(first.id)).toBe(1);
    });

    it('drops to zero once everyone ahead is done', async () => {
      const service = commands();
      const first = await admit();
      const second = await admit();

      await service.call(fx.clinicId, first.id, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, first.id, {
        memberId: fx.doctorMemberId,
      });
      await service.complete(fx.clinicId, first.id, {
        memberId: fx.doctorMemberId,
      });

      expect(await entries().aheadCount(second.id)).toBe(0);
    });
  });

  describe('reordering', () => {
    it('moves one patient without renumbering anyone', async () => {
      const service = commands();
      const a = await admit();
      const b = await admit();
      const c = await admit();

      // Put C between A and B.
      await service.move(
        fx.clinicId,
        c.id,
        { beforeEntryId: b.id, afterEntryId: a.id },
        { memberId: fx.doctorMemberId },
      );

      const order = await entries().listActive(sessionId);
      expect(order.map((e) => e.id)).toEqual([a.id, c.id, b.id]);
      expect(order.map((e) => e.ticketNumber)).toEqual([
        a.ticketNumber,
        c.ticketNumber,
        b.ticketNumber,
      ]);
    });

    it('rejects missing, duplicate, self, reversed and foreign neighbours', async () => {
      const service = commands();
      const a = await admit();
      const b = await admit();
      const c = await admit();
      const foreignSession = await insertSession(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        kind: 'evening',
        status: 'open',
      });
      const foreign = await service.admit(
        {
          clinicId: fx.clinicId,
          sessionId: foreignSession,
          childId: await child(),
        },
        { memberId: fx.doctorMemberId },
      );

      for (const target of [
        {},
        { beforeEntryId: c.id },
        { beforeEntryId: b.id, afterEntryId: b.id },
        { beforeEntryId: a.id, afterEntryId: b.id },
        { beforeEntryId: '00000000-0000-4000-8000-000000000000' },
        { beforeEntryId: foreign.id },
      ]) {
        await expect(
          service.move(fx.clinicId, c.id, target, {
            memberId: fx.doctorMemberId,
          }),
        ).rejects.toMatchObject({ code: QueueErrorCode.InvalidTransition });
      }

      await service.call(fx.clinicId, a.id, {
        memberId: fx.doctorMemberId,
      });
      await expect(
        service.move(
          fx.clinicId,
          a.id,
          { beforeEntryId: b.id },
          { memberId: fx.doctorMemberId },
        ),
      ).rejects.toMatchObject({ code: QueueErrorCode.InvalidTransition });
      await expect(
        service.move(
          fx.clinicId,
          c.id,
          { afterEntryId: a.id },
          { memberId: fx.doctorMemberId },
        ),
      ).rejects.toMatchObject({ code: QueueErrorCode.InvalidTransition });
    });
  });

  describe('a parent deferring', () => {
    it('lets one person past, and counts it', async () => {
      const service = commands();
      const mine = await admit();
      const next = await admit();
      await admit();

      const deferred = await service.defer(fx.clinicId, mine.id, {
        authUserId: '00000000-0000-0000-0000-000000000001',
      });

      expect(deferred.deferCount).toBe(1);
      const order = await entries().listActive(sessionId);
      expect(order[0].id).toBe(next.id);
      expect(order[1].id).toBe(mine.id);
    });

    it('stops at the clinic’s limit', async () => {
      const service = commands();
      const mine = await admit();
      await admit();
      await admit();
      const actor = { authUserId: '00000000-0000-0000-0000-000000000001' };

      await service.defer(fx.clinicId, mine.id, actor);
      await service.defer(fx.clinicId, mine.id, actor);

      await expect(
        service.defer(fx.clinicId, mine.id, actor),
      ).rejects.toMatchObject({
        code: QueueErrorCode.DeferLimitReached,
        details: { maxSelfDefers: 2 },
      });
    });

    it('is refused once the turn has been called', async () => {
      const service = commands();
      const mine = await admit();
      await service.call(fx.clinicId, mine.id, {
        memberId: fx.doctorMemberId,
      });

      await expect(
        service.defer(fx.clinicId, mine.id, {
          authUserId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toMatchObject({ code: QueueErrorCode.InvalidTransition });
    });
  });

  describe('tenant isolation', () => {
    it('refuses an entry belonging to another clinic', async () => {
      const entry = await admit();
      await expect(
        commands().call(fx.otherClinicId, entry.id, {
          memberId: fx.otherDoctorMemberId,
        }),
      ).rejects.toMatchObject({ code: QueueErrorCode.EntryNotFound });
    });
  });

  describe('the audit trail', () => {
    it('records every move, in order, with who did it', async () => {
      const service = commands();
      const entry = await admit();
      await service.call(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      await service.start(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });
      await service.complete(fx.clinicId, entry.id, {
        memberId: fx.doctorMemberId,
      });

      const events = await fx.db.database.query<{
        event_type: string;
        from_status: string | null;
        to_status: string | null;
        performed_by_member_id: string | null;
      }>(
        `select event_type, from_status, to_status, performed_by_member_id
           from clinic.queue_events
          where entry_id = $1 order by created_at`,
        [entry.id],
      );

      expect(events.rows.map((r) => r.event_type)).toEqual([
        'checked_in',
        'called',
        'started',
        'completed',
      ]);
      for (const row of events.rows) {
        expect(row.performed_by_member_id).toBe(fx.doctorMemberId);
      }
    });
  });
});

import { ClinicScheduleService } from './clinic-schedule.service';
import {
  describeWithDatabase,
  insertSchedule,
  weekdayOf,
} from './clinic.fixture';

/**
 * The template, and the exceptions to it.
 *
 * The predicate worth testing is closure *overlap*. Availability subtracts
 * closures from windows, and a containment test instead of an overlap test is
 * how a clinic ends up booking patients into a lunch break that starts halfway
 * through the hour.
 */
describeWithDatabase('clinic schedules', (fx) => {
  const schedules = () => new ClinicScheduleService(fx.db.database);

  const DATE = '2030-03-12'; // A Tuesday.
  let tuesday: number;

  beforeAll(async () => {
    tuesday = await weekdayOf(fx.db.database, DATE);
  });

  afterEach(async () => {
    const clinics = [fx.clinicId, fx.otherClinicId, fx.farEastClinicId];
    await fx.db.database.query(
      `delete from clinic.clinic_closures where clinic_id = any($1)`,
      [clinics],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_schedules where clinic_id = any($1)`,
      [clinics],
    );
  });

  describe('finding the schedule for a date', () => {
    it('returns times as wall clock, not as instants', async () => {
      // "Ten in the morning" survives a daylight-saving change; a stored
      // instant does not, and a screen cannot render 10:00:00 either.
      await insertSchedule(fx.db.database, {
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        weekday: tuesday,
        startsAt: '10:00',
        endsAt: '16:00',
      });

      const [schedule] = await schedules().findForDate(fx.clinicId, DATE);

      expect(schedule.startsAt).toBe('10:00');
      expect(schedule.endsAt).toBe('16:00');
      expect(schedule.effectiveFrom).toBe('2000-01-01');
      expect(schedule.effectiveTo).toBeNull();
    });

    it('keeps only the newest schedule effective for the date', async () => {
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
        capacityPerWindow: 8,
        effectiveFrom: '2029-06-01',
      });

      const found = await schedules().findForDate(fx.clinicId, DATE);

      expect(found).toHaveLength(1);
      expect(found[0].capacityPerWindow).toBe(8);
    });

    it('returns nothing on a day with no schedule', async () => {
      // A closed day is the absence of a schedule, not a schedule with a flag:
      // availability then has nothing to generate.
      expect(await schedules().findForDate(fx.clinicId, DATE)).toEqual([]);
    });

    it('does not read another clinic’s schedules', async () => {
      await insertSchedule(fx.db.database, {
        clinicId: fx.otherClinicId,
        doctorMemberId: fx.otherDoctorMemberId,
        weekday: tuesday,
      });

      expect(await schedules().findForDate(fx.clinicId, DATE)).toEqual([]);
    });
  });

  describe('closures', () => {
    const span = (fromHour: number, toHour: number) => ({
      startsAt: `2030-03-12T${String(fromHour).padStart(2, '0')}:00:00Z`,
      endsAt: `2030-03-12T${String(toHour).padStart(2, '0')}:00:00Z`,
    });

    async function closure(fromHour: number, toHour: number, reason = 'إجازة') {
      const { startsAt, endsAt } = span(fromHour, toHour);
      return schedules().createClosure({
        clinicId: fx.clinicId,
        startsAt,
        endsAt,
        reason,
      });
    }

    it('finds a closure that starts inside the window', async () => {
      await closure(11, 14);
      const found = await schedules().findOverlapping(
        fx.clinicId,
        span(10, 12).startsAt,
        span(10, 12).endsAt,
      );
      expect(found).toHaveLength(1);
    });

    it('finds a closure that merely straddles the window', async () => {
      // 09:00–17:00 contains a 10:00–12:00 window without starting or ending
      // inside it. A containment test would miss this entirely.
      await closure(9, 17);
      const found = await schedules().findOverlapping(
        fx.clinicId,
        span(10, 12).startsAt,
        span(10, 12).endsAt,
      );
      expect(found).toHaveLength(1);
    });

    it('finds a closure fully inside the window', async () => {
      await closure(10, 11, 'استراحة');
      const found = await schedules().findOverlapping(
        fx.clinicId,
        span(9, 13).startsAt,
        span(9, 13).endsAt,
      );
      expect(found).toHaveLength(1);
      expect(found[0].reason).toBe('استراحة');
    });

    it('ignores a closure that merely touches the window’s edge', async () => {
      // A closure ending exactly at 10:00 does not affect the 10:00 window.
      // Half-open intervals, so back-to-back periods do not fight.
      await closure(8, 10);
      const found = await schedules().findOverlapping(
        fx.clinicId,
        span(10, 12).startsAt,
        span(10, 12).endsAt,
      );
      expect(found).toEqual([]);
    });

    it('ignores a closure that starts exactly when the window ends', async () => {
      await closure(12, 14);
      const found = await schedules().findOverlapping(
        fx.clinicId,
        span(10, 12).startsAt,
        span(10, 12).endsAt,
      );
      expect(found).toEqual([]);
    });

    it('records who and what, and whether one doctor or the clinic', async () => {
      const created = await schedules().createClosure({
        clinicId: fx.clinicId,
        doctorMemberId: fx.doctorMemberId,
        startsAt: span(10, 12).startsAt,
        endsAt: span(10, 12).endsAt,
        reason: '  مؤتمر  ',
        createdByMemberId: fx.doctorMemberId,
      });

      expect(created.doctorMemberId).toBe(fx.doctorMemberId);
      expect(created.reason).toBe('مؤتمر');
    });

    it('defaults to closing the whole clinic', async () => {
      const created = await closure(10, 12);
      expect(created.doctorMemberId).toBeNull();
    });

    it('does not see another clinic’s closures', async () => {
      await schedules().createClosure({
        clinicId: fx.otherClinicId,
        startsAt: span(10, 12).startsAt,
        endsAt: span(10, 12).endsAt,
        reason: 'إجازة',
      });

      const found = await schedules().findOverlapping(
        fx.clinicId,
        span(9, 18).startsAt,
        span(9, 18).endsAt,
      );
      expect(found).toEqual([]);
    });
  });
});

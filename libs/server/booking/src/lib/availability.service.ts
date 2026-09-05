import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import { ClinicSessionService } from '@clinic/server-clinic';
import type {
  AvailabilityDay,
  AvailabilityWindow,
  ClinicSessionKind,
} from '@clinic/contracts';

interface WindowRow extends QueryResultRow {
  session_id: string;
  session_kind: string;
  session_date: string;
  window_start: Date;
  window_end: Date;
  capacity: number;
  taken: string;
}

export interface AvailabilityQuery {
  /** Clinic-local dates, inclusive. */
  from: string;
  to: string;
  /** Staff see full windows so they can see *why* a day is unbookable. */
  includeFull?: boolean;
}

/**
 * What a parent can actually book.
 *
 * Advisory, and it says so. The number here is true when it is computed and a
 * booking can still lose the race for the last seat — `appointments_seat_uq` is
 * the only thing that actually decides. Clients handle the conflict rather than
 * trusting the count.
 *
 * The whole computation is one query. Generating windows in TypeScript and then
 * counting appointments per window would be a round trip per window, and it
 * would put the clinic's day boundary in two places.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessions: ClinicSessionService,
  ) {}

  /**
   * Windows for a span of clinic-local days, grouped by day.
   *
   * Materialises first: a session has to exist before anything can be booked
   * into it, and the first person to look at a day is the one who creates it.
   * That is idempotent, so it is safe to do on a read.
   */
  async forRange(
    clinicId: string,
    query: AvailabilityQuery,
    db: SqlExecutor = this.database,
  ): Promise<AvailabilityDay[]> {
    await this.sessions.ensureForRange(clinicId, query.from, query.to, db);

    const rows = await db.query<WindowRow>(
      `
      with live_sessions as (
        select id, doctor_member_id, session_kind, session_date,
               planned_start, planned_end, window_minutes, capacity_per_window
          from clinic.clinic_sessions
         where clinic_id = $1
           and session_date between $2::date and $3::date
           -- A closed session is over. Paused is transient and says nothing
           -- about whether a future window can be booked.
           and status <> 'closed'
      ),
      windows as (
        select s.id                as session_id,
               s.doctor_member_id,
               s.session_kind,
               s.session_date,
               w.start_at          as window_start,
               -- A session whose length is not a whole number of windows ends
               -- with a short one rather than one that overruns the day.
               least(
                 w.start_at + make_interval(mins => s.window_minutes),
                 s.planned_end
               )                   as window_end,
               s.capacity_per_window as capacity
          from live_sessions s
          cross join lateral generate_series(
            s.planned_start,
            s.planned_end - interval '1 microsecond',
            make_interval(mins => s.window_minutes)
          ) as w(start_at)
      ),
      taken as (
        select session_id, window_start, count(*) as taken
          from clinic.appointments
         where session_id in (select id from live_sessions)
           -- A requested appointment holds its seat, so approval can never
           -- fail on capacity.
           and status in ('requested', 'confirmed', 'checked_in')
         group by session_id, window_start
      )
      select w.session_id,
             w.session_kind,
             w.session_date::text as session_date,
             w.window_start,
             w.window_end,
             w.capacity,
             coalesce(t.taken, 0)::text as taken
        from windows w
        left join taken t
          on t.session_id = w.session_id
         and t.window_start = w.window_start
       where
         -- Past windows are not bookable, and min_lead_minutes is the clinic's
         -- own cutoff for how close to a window it will still take a booking.
         -- Read here rather than passed in: it is a rule this service applies,
         -- not a value any client has a use for.
         w.window_start >= now() + make_interval(
           mins => (select min_lead_minutes from clinic.clinics where id = $1)
         )
         -- Overlap, not containment: a closure from 11:30 to 12:30 removes the
         -- 11:00 window even though it neither starts nor ends inside it.
         and not exists (
           select 1
             from clinic.clinic_closures c
            where c.clinic_id = $1
              and (c.doctor_member_id is null
                   or c.doctor_member_id = w.doctor_member_id)
              and c.starts_at < w.window_end
              and c.ends_at   > w.window_start
         )
       order by w.window_start, w.session_id
      `,
      [clinicId, query.from, query.to],
    );

    return group(
      rows.rows
        .map(toWindow)
        .filter(
          (entry) => query.includeFull === true || entry.window.remaining > 0,
        ),
    );
  }
}

interface DatedWindow {
  date: string;
  window: AvailabilityWindow;
}

function toWindow(row: WindowRow): DatedWindow {
  const capacity = row.capacity;
  const taken = Number(row.taken);
  return {
    date: row.session_date,
    window: {
      sessionId: row.session_id,
      sessionKind: row.session_kind as ClinicSessionKind,
      windowStart: row.window_start.toISOString(),
      windowEnd: row.window_end.toISOString(),
      capacity,
      taken,
      // Clamped: a window cannot report negative space left, and if `taken`
      // ever exceeded capacity that is a bug to see in the data, not one to
      // propagate into a screen.
      remaining: Math.max(capacity - taken, 0),
    },
  };
}

/** Grouped by clinic-local day, which is how every day picker renders them. */
function group(entries: DatedWindow[]): AvailabilityDay[] {
  const days = new Map<string, AvailabilityWindow[]>();
  for (const entry of entries) {
    const bucket = days.get(entry.date);
    if (bucket === undefined) {
      days.set(entry.date, [entry.window]);
    } else {
      bucket.push(entry.window);
    }
  }
  return [...days.entries()]
    .map(([date, windows]) => ({ date, windows }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

-- The operational day: schedules, closures, and the sessions they produce.
--
-- This is the substrate Booking and Queue both stand on, and the reason neither
-- has to know the other exists. Booking reads a session's capacity to compute
-- availability; Queue writes the session's operational state and takes its row
-- lock; the session owns everything that belongs to a *day* rather than to a
-- patient — the ticket counter, whether the queue is running, whether the
-- doctor has arrived.
--
-- Three decisions are load-bearing:
--
--   1. `clinic_sessions` is a real table, not a view over schedules. A schedule
--      is a template; a session is what actually happened on a date, including
--      the parts no template can predict.
--   2. Doctor presence and pace live here, once per session — never on every
--      waiting patient. Writing "the doctor is late" onto fifteen rows means
--      getting it wrong on at least one.
--   3. `revision` exists so a 5-second poll can be told "nothing changed"
--      instead of re-sending the whole board.

-- ---------------------------------------------------------------------------
-- The weekly template
-- ---------------------------------------------------------------------------

create table clinic.clinic_schedules (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references clinic.clinics (id),
  doctor_member_id    uuid not null references clinic.clinic_members (id),

  -- Postgres' own convention, so `extract(dow from ...)` compares directly and
  -- nobody has to remember a second numbering.
  weekday             smallint not null check (weekday between 0 and 6),
  session_kind        text not null check (session_kind in ('morning', 'evening')),

  -- Local wall-clock times. Resolved against the clinic's timezone when a
  -- session is materialised — storing an instant here would be wrong twice a
  -- year in any zone with DST, and wrong immediately if the clinic moves.
  starts_at           time not null,
  ends_at             time not null,

  -- The arrival-window model: patients are told a range and the queue orders by
  -- actual arrival. Both numbers are per-schedule so a busier evening can carry
  -- a different capacity without a release.
  window_minutes      integer not null default 60
                        check (window_minutes between 5 and 240),
  capacity_per_window integer not null default 5
                        check (capacity_per_window between 1 and 50),

  effective_from      date not null,
  -- Null means open-ended. A schedule is superseded by dating it, never by
  -- deleting it: appointments already booked against the old shape must stay
  -- explicable.
  effective_to        date null,
  active              boolean not null default true,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint clinic_schedules_span_ck check (ends_at > starts_at),
  constraint clinic_schedules_effective_ck
    check (effective_to is null or effective_to >= effective_from)
);

comment on table clinic.clinic_schedules is
  'Weekly template. Produces clinic_sessions; never consulted at queue time.';

-- One schedule per doctor, per weekday, per half-day, per revision.
create unique index clinic_schedules_slot_uq
  on clinic.clinic_schedules
     (clinic_id, doctor_member_id, weekday, session_kind, effective_from);

-- The availability lookup: "what does this clinic run on a Tuesday?"
create index clinic_schedules_weekday_idx
  on clinic.clinic_schedules (clinic_id, weekday)
  where active;

-- The unique index leads with clinic_id, so the FK column needs its own.
create index clinic_schedules_doctor_idx
  on clinic.clinic_schedules (doctor_member_id);

create trigger clinic_schedules_set_updated_at
  before update on clinic.clinic_schedules
  for each row execute function clinic.set_updated_at();

-- ---------------------------------------------------------------------------
-- Exceptions to the template
-- ---------------------------------------------------------------------------

create table clinic.clinic_closures (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinic.clinics (id),
  -- Null means the whole clinic is closed, not one doctor.
  doctor_member_id     uuid null references clinic.clinic_members (id),

  -- Instants, unlike a schedule: a closure is a specific absence, and half of
  -- them are entered as "from now until 4pm".
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  reason               text not null check (length(btrim(reason)) > 0),

  created_by_member_id uuid null references clinic.clinic_members (id),
  created_at           timestamptz not null default now(),

  constraint clinic_closures_span_ck check (ends_at > starts_at)
);

comment on table clinic.clinic_closures is
  'Holidays, breaks and ad-hoc absence. Subtracts windows from availability; '
  'deliberately does NOT cancel appointments already booked.';

create index clinic_closures_window_idx
  on clinic.clinic_closures (clinic_id, starts_at, ends_at);

create index clinic_closures_doctor_idx
  on clinic.clinic_closures (doctor_member_id);

create index clinic_closures_created_by_idx
  on clinic.clinic_closures (created_by_member_id);

-- ---------------------------------------------------------------------------
-- The operational day
-- ---------------------------------------------------------------------------

create table clinic.clinic_sessions (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references clinic.clinics (id),
  doctor_member_id    uuid not null references clinic.clinic_members (id),

  -- The clinic's own date, in the clinic's own zone. At 22:30 UTC it is already
  -- tomorrow in Cairo, so this is never derived from a server or browser clock.
  session_date        date not null,
  session_kind        text not null check (session_kind in ('morning', 'evening')),

  -- Copied from the schedule at materialisation rather than joined at read
  -- time. A schedule edited in March must not silently move a session booked
  -- in February.
  planned_start       timestamptz not null,
  planned_end         timestamptz not null,
  window_minutes      integer not null check (window_minutes between 5 and 240),
  capacity_per_window integer not null check (capacity_per_window between 1 and 50),

  -- Operational state. Queue writes these; Booking only reads them.
  status              text not null default 'scheduled'
                        check (status in ('scheduled', 'open', 'paused', 'closed')),
  doctor_presence     text not null default 'expected'
                        check (doctor_presence in
                          ('expected', 'arrived', 'en_route', 'not_arrived')),
  delay_minutes       integer null check (delay_minutes >= 0),
  delay_note          text null,
  presence_updated_at timestamptz null,

  -- Staff's live estimate, adjustable during the day. Feeds a coarse waiting
  -- band, never a ticking countdown.
  avg_consult_minutes integer not null check (avg_consult_minutes between 1 and 240),

  -- The human-visible ticket counter, allocated under this row's lock.
  next_ticket_number  integer not null default 1 check (next_ticket_number >= 1),

  -- Bumped by every queue mutation, so a poll can be answered with "unchanged".
  revision            bigint not null default 0 check (revision >= 0),

  opened_at           timestamptz null,
  closed_at           timestamptz null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint clinic_sessions_span_ck check (planned_end > planned_start)
);

comment on table clinic.clinic_sessions is
  'One concrete half-day. The concurrency root: every queue mutation and every '
  'check-in takes SELECT ... FOR UPDATE on this row first.';

comment on column clinic.clinic_sessions.revision is
  'Incremented by every queue mutation so a poll can short-circuit.';

-- Materialisation is idempotent because of this index: `insert ... on conflict
-- do nothing` is what makes two simultaneous first-bookings safe.
create unique index clinic_sessions_day_uq
  on clinic.clinic_sessions
     (clinic_id, doctor_member_id, session_date, session_kind);

-- The day view, for both the dashboard and availability.
create index clinic_sessions_date_idx
  on clinic.clinic_sessions (clinic_id, session_date);

-- "What is running right now" — small, and hit on every queue poll.
create index clinic_sessions_live_idx
  on clinic.clinic_sessions (clinic_id, status)
  where status in ('open', 'paused');

create index clinic_sessions_doctor_idx
  on clinic.clinic_sessions (doctor_member_id);

create trigger clinic_sessions_set_updated_at
  before update on clinic.clinic_sessions
  for each row execute function clinic.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS and grants, matching the posture set by the identity migration.
--
-- The schema's absence from [api].schemas is what keeps a publishable key away
-- from this data; RLS is the second lock, and FORCE matters because the owner
-- (who migrations run as) would otherwise be exempt.
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'clinic_schedules', 'clinic_closures', 'clinic_sessions'
  ]
  loop
    execute format('alter table clinic.%I enable row level security', target);
    execute format('alter table clinic.%I force row level security', target);
    execute format(
      'create policy %I on clinic.%I for all to clinic_api using (true) with check (true)',
      target || '_clinic_api', target);
  end loop;
end
$$;

-- Schedules and closures are managed by staff; the settings screen is Phase 3,
-- but reception already needs to record an unexpected closure.
grant select, insert, update, delete on clinic.clinic_schedules to clinic_api;
grant select, insert, update, delete on clinic.clinic_closures  to clinic_api;

-- Sessions are created by materialisation and never deleted: a closed session
-- is the record of a day that happened, and queue entries point at it.
grant select, insert, update         on clinic.clinic_sessions   to clinic_api;

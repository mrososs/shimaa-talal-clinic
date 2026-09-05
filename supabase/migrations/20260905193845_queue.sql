-- The live queue.
--
-- Four partial unique indexes at the bottom of this file are the concurrency
-- design. Not a lock in the application, not a mutex, not "the UI disables the
-- button": two receptionists pressing Call Next at the same instant both reach
-- the UPDATE, and PostgreSQL decides which one wins.
--
--   queue_ticket_uq          two patients cannot hold the same number
--   queue_appointment_uq     one appointment checks in once, ever
--   queue_one_called_uq      at most one patient is being called
--   queue_one_in_service_uq  at most one patient is with the doctor
--
-- Three modelling decisions worth stating, because each removes a whole class
-- of bug rather than fixing one:
--
--   1. `ticket_number` and `sort_key` are different columns doing different
--      jobs. The number is what the patient is told and it never changes; the
--      sort key decides who is next and moves freely. Conflating them is what
--      makes "patients ahead" wrong the moment anyone is reordered.
--   2. Emergency is a `priority`, not a status. A patient can be urgent AND
--      waiting AND called; a status column cannot express that, and a second
--      status column is worse.
--   3. Grace is a deadline, not a state. `called` carries `grace_expires_at`,
--      and whether it has lapsed is a comparison against the clock. Nothing
--      expires on a timer — there is no scheduler in this system, and a
--      receptionist looking up and calling the next name is what actually
--      happens in a clinic.

create table clinic.queue_entries (
  id                     uuid primary key default gen_random_uuid(),
  clinic_id              uuid not null references clinic.clinics (id),
  session_id             uuid not null references clinic.clinic_sessions (id),

  -- Null for a walk-in, and that is an ordinary case rather than an exception.
  -- No appointment row is ever fabricated to satisfy this column: the queue
  -- must work for a patient with no booking, no app and no account.
  appointment_id         uuid null references clinic.appointments (id),

  child_id               uuid not null references clinic.children (id),
  -- Null for an unaccompanied or unidentified walk-in. Rare, and real.
  guardian_id            uuid null references clinic.guardians (id),

  source                 text not null
                           check (source in ('appointment', 'walk_in')),

  -- The human number: "رقمك ٢٤". Allocated under the session's row lock and
  -- immutable while the entry lives. Never used for ordering.
  ticket_number          integer not null check (ticket_number >= 1),

  -- Service order within a priority band. Appended with gaps of 1000; an
  -- insertion between two neighbours takes their midpoint, which touches one
  -- row instead of renumbering everything below it.
  sort_key               numeric(20, 6) not null,

  -- Lower is served earlier. 10 is emergency, 100 is everyone else. Nothing
  -- else uses this in the MVP, and a triage scale is not wanted.
  priority               smallint not null default 100 check (priority > 0),

  status                 text not null default 'waiting'
                           check (status in ('waiting', 'called', 'in_service',
                                             'missed', 'done', 'cancelled')),

  visit_reason           text null,

  checked_in_at          timestamptz not null default now(),
  called_at              timestamptz null,
  -- Set the moment the patient is called; read by staff and by the parent's
  -- countdown. Never acted on by a timer.
  grace_expires_at       timestamptz null,
  started_at             timestamptz null,
  completed_at           timestamptz null,

  -- How many times the parent has deferred their own turn today.
  defer_count            smallint not null default 0 check (defer_count >= 0),

  -- Denormalised onto the entry so the board can render "why" without a join,
  -- while `queue_events` keeps the full trail.
  emergency_reason       text null,
  emergency_marked_by    uuid null references clinic.clinic_members (id),
  emergency_marked_at    timestamptz null,

  -- Null would mean parent-initiated. Check-in is always staff in this phase.
  created_by_member_id   uuid null references clinic.clinic_members (id),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- A called patient without a deadline cannot be missed, so the grace rule
  -- would silently never apply.
  constraint queue_called_needs_grace_ck
    check (status <> 'called' or grace_expires_at is not null),

  -- An emergency has to say why. The one field that makes the audit trail
  -- worth reading six months later.
  constraint queue_emergency_needs_reason_ck
    check (priority >= 100 or emergency_reason is not null),

  constraint queue_walkin_has_no_appointment_ck
    check ((source = 'walk_in') = (appointment_id is null))
);

comment on table clinic.queue_entries is
  'A patient''s place in today''s queue. Created at check-in or walk-in, never in advance.';

comment on column clinic.queue_entries.ticket_number is
  'The number the patient is told. Immutable. NOT a position — use a count.';

comment on column clinic.queue_entries.sort_key is
  'Service order. Midpoint insertion, never renumbered.';

-- ---------------------------------------------------------------------------
-- The concurrency guarantees
-- ---------------------------------------------------------------------------

-- Two patients cannot hold the same number in one session.
create unique index queue_ticket_uq
  on clinic.queue_entries (session_id, ticket_number);

-- One appointment checks in once. A second attempt is a double-click, and the
-- API answers it with the entry that already exists rather than an error.
create unique index queue_appointment_uq
  on clinic.queue_entries (appointment_id)
  where appointment_id is not null and status <> 'cancelled';

-- At most one patient is being called at a time. This is what makes two staff
-- pressing Call Next simultaneously resolve to one winner and one clean 409.
create unique index queue_one_called_uq
  on clinic.queue_entries (session_id)
  where status = 'called';

-- At most one patient is with the doctor.
create unique index queue_one_in_service_uq
  on clinic.queue_entries (session_id)
  where status = 'in_service';

-- ---------------------------------------------------------------------------
-- Read paths
-- ---------------------------------------------------------------------------

-- The ordering index, and the shape every board query uses:
--   order by priority, sort_key
create index queue_order_idx
  on clinic.queue_entries (session_id, priority, sort_key)
  where status in ('waiting', 'called', 'in_service');

-- The whole day, including what is finished — the board shows those too.
create index queue_session_idx
  on clinic.queue_entries (session_id, status);

-- A parent asking about their own child.
create index queue_child_idx
  on clinic.queue_entries (child_id, checked_in_at desc);

create index queue_guardian_idx
  on clinic.queue_entries (guardian_id, checked_in_at desc);

create index queue_clinic_idx
  on clinic.queue_entries (clinic_id, checked_in_at desc);

-- Foreign keys whose columns lead no other index. The appointment one is
-- covered only by a *partial* index, which cannot serve a general lookup.
create index queue_appointment_idx
  on clinic.queue_entries (appointment_id);

create index queue_created_by_idx
  on clinic.queue_entries (created_by_member_id);

create index queue_emergency_by_idx
  on clinic.queue_entries (emergency_marked_by);

create trigger queue_entries_set_updated_at
  before update on clinic.queue_entries
  for each row execute function clinic.set_updated_at();

-- ---------------------------------------------------------------------------
-- The audit trail
--
-- Every mutation writes one row here, in the same transaction as the state
-- change it describes. An event written afterwards is an event that can be
-- missing.
-- ---------------------------------------------------------------------------

create table clinic.queue_events (
  id                        uuid primary key default gen_random_uuid(),
  entry_id                  uuid not null references clinic.queue_entries (id),
  session_id                uuid not null references clinic.clinic_sessions (id),

  event_type                text not null
                              check (event_type in
                                ('checked_in', 'called', 'started', 'completed',
                                 'missed', 'requeued', 'deferred',
                                 'emergency_set', 'emergency_cleared',
                                 'moved', 'cancelled')),
  from_status               text null,
  to_status                 text null,

  -- Exactly one of these is set: staff acted, or the parent did.
  performed_by_member_id    uuid null references clinic.clinic_members (id),
  performed_by_auth_user_id uuid null,

  reason                    text null,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now()
);

comment on table clinic.queue_events is
  'Append-only. Written inside the same transaction as the change it records.';

create index queue_events_session_idx
  on clinic.queue_events (session_id, created_at);

create index queue_events_entry_idx
  on clinic.queue_events (entry_id, created_at);

create index queue_events_member_idx
  on clinic.queue_events (performed_by_member_id);

-- ---------------------------------------------------------------------------
-- RLS and grants, matching the posture set by the identity migration.
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['queue_entries', 'queue_events']
  loop
    execute format('alter table clinic.%I enable row level security', target);
    execute format('alter table clinic.%I force row level security', target);
    execute format(
      'create policy %I on clinic.%I for all to clinic_api using (true) with check (true)',
      target || '_clinic_api', target);
  end loop;
end
$$;

-- Entries are cancelled, never deleted: a patient who was removed from the
-- queue is part of what happened that day.
grant select, insert, update on clinic.queue_entries to clinic_api;

-- Append-only in the strict sense. An audit trail the application can rewrite
-- is not one.
grant select, insert         on clinic.queue_events  to clinic_api;

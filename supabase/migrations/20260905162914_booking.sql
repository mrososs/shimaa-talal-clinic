-- Appointments: the booked visit, and nothing else.
--
-- The two partial unique indexes at the bottom of this file are the entire
-- capacity guarantee. Not the availability endpoint, which is advisory and
-- always will be; not a counter column, which drifts the first time a
-- cancellation is missed. Two parents submitting for the same last seat both
-- reach the INSERT, and PostgreSQL decides.
--
-- What is deliberately absent:
--
--   * Any queue column. An appointment is not a queue entry. `checked_in` is
--     the one place the two touch, and it means only that an entry now exists.
--   * Any payment column. Booking and Payments are separate engines, and a fee
--     on this table would be the first thread of a coupling that is very hard
--     to pull back out.
--   * A `rescheduled` status. Rescheduling mutates the appointment and appends
--     an event; a terminal status would leave the row inert and force a second
--     row for one visit.

create table clinic.appointments (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references clinic.clinics (id),
  session_id            uuid not null references clinic.clinic_sessions (id),

  child_id              uuid not null references clinic.children (id),
  -- Which caregiver made the booking. A child has several guardians, so this
  -- is not "the child's guardian" — it is the one who called.
  guardian_id           uuid not null references clinic.guardians (id),

  -- The arrival window, denormalised from the session. A parent is told a
  -- range and the queue orders by actual arrival, so there is no appointment
  -- "time" here to promise.
  window_start          timestamptz not null,
  window_end            timestamptz not null,

  -- A capacity token, 1..capacity_per_window, and nothing more. It exists so a
  -- unique index can exist; it is never shown to anyone, because rendering it
  -- as a minute would quietly turn the window back into a slot.
  seat_no               smallint not null check (seat_no >= 1),

  visit_type            text not null
                          check (visit_type in ('new_visit', 'follow_up',
                                                'vaccination', 'consultation',
                                                'newborn')),
  status                text not null default 'requested'
                          check (status in ('requested', 'confirmed',
                                            'checked_in', 'completed',
                                            'cancelled', 'no_show')),
  notes                 text null,

  -- Null means the parent booked it. This is how "who booked this" is answered.
  created_by_member_id  uuid null references clinic.clinic_members (id),

  cancelled_at          timestamptz null,
  -- A clinic rejection is a cancellation with a different author, not a status
  -- of its own: reporting can tell them apart and the state machine need not.
  cancelled_by          text null check (cancelled_by in ('parent', 'clinic')),
  cancellation_reason   text null,

  -- The audit trail for a reschedule, without a status for it.
  rescheduled_from_appointment_id uuid null references clinic.appointments (id),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint appointments_window_ck check (window_end > window_start),
  -- A cancelled appointment must say who cancelled it. Anything else leaves a
  -- row nobody can explain six months later.
  constraint appointments_cancelled_ck
    check ((status <> 'cancelled') or (cancelled_at is not null
                                       and cancelled_by is not null))
);

comment on table clinic.appointments is
  'A booked visit. Owns no queue state and no payment state.';

comment on column clinic.appointments.seat_no is
  'Capacity token only. Never rendered: it is not a minute-level time.';

-- ---------------------------------------------------------------------------
-- The capacity guarantee
-- ---------------------------------------------------------------------------

-- One seat, one live appointment. This is what makes two parents racing for the
-- last place resolve correctly: one commits, the other gets a unique violation
-- and retries into the next free seat or a clean 409.
--
-- Partial on the live statuses, so cancelling releases the seat with no counter
-- to decrement and nothing to drift.
create unique index appointments_seat_uq
  on clinic.appointments (session_id, window_start, seat_no)
  where status in ('requested', 'confirmed', 'checked_in');

-- One child, one live appointment per session. Kills the double-tap on
-- "confirm", and the case where a parent books the same child twice from two
-- devices.
create unique index appointments_child_session_uq
  on clinic.appointments (session_id, child_id)
  where status in ('requested', 'confirmed', 'checked_in');

-- ---------------------------------------------------------------------------
-- Read paths
-- ---------------------------------------------------------------------------

-- The clinic's day view.
create index appointments_day_idx
  on clinic.appointments (clinic_id, window_start);

-- "My appointments", newest first, for both parent screens.
create index appointments_guardian_idx
  on clinic.appointments (guardian_id, window_start desc);

create index appointments_child_idx
  on clinic.appointments (child_id, window_start desc);

-- Availability counts live appointments per session; the board filters by
-- status within one.
create index appointments_session_status_idx
  on clinic.appointments (session_id, status);

-- Foreign keys with no leading index of their own.
create index appointments_created_by_idx
  on clinic.appointments (created_by_member_id);

create index appointments_rescheduled_from_idx
  on clinic.appointments (rescheduled_from_appointment_id);

create trigger appointments_set_updated_at
  before update on clinic.appointments
  for each row execute function clinic.set_updated_at();

-- ---------------------------------------------------------------------------
-- The audit trail
-- ---------------------------------------------------------------------------

create table clinic.appointment_events (
  id                       uuid primary key default gen_random_uuid(),
  appointment_id           uuid not null references clinic.appointments (id),

  event_type               text not null check (length(btrim(event_type)) > 0),
  from_status              text null,
  to_status                text null,

  -- Exactly one of these is set: staff acted, or the parent did.
  performed_by_member_id   uuid null references clinic.clinic_members (id),
  performed_by_auth_user_id uuid null,

  reason                   text null,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now()
);

comment on table clinic.appointment_events is
  'Append-only. Written inside the same transaction as the state change it describes.';

create index appointment_events_appointment_idx
  on clinic.appointment_events (appointment_id, created_at);

create index appointment_events_member_idx
  on clinic.appointment_events (performed_by_member_id);

-- ---------------------------------------------------------------------------
-- RLS and grants, matching the posture set by the identity migration.
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['appointments', 'appointment_events']
  loop
    execute format('alter table clinic.%I enable row level security', target);
    execute format('alter table clinic.%I force row level security', target);
    execute format(
      'create policy %I on clinic.%I for all to clinic_api using (true) with check (true)',
      target || '_clinic_api', target);
  end loop;
end
$$;

-- Appointments are cancelled, never deleted: the visit history is the record.
grant select, insert, update on clinic.appointments       to clinic_api;

-- Append-only in the strict sense — no UPDATE, no DELETE. An audit trail the
-- application can rewrite is not one.
grant select, insert         on clinic.appointment_events to clinic_api;

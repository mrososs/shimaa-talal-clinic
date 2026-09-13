-- Booking tracking foundation.
--
-- This migration stores only operational facts and the last user-facing
-- publication. Raw estimates, positions and observed pace remain derived in
-- server-workflows.

alter table clinic.clinics
  add column tracking_estimator_enabled boolean not null default false,
  add column reception_estimate_visible boolean not null default false,
  add column parent_estimate_visible boolean not null default false,
  add column guest_tracking_enabled boolean not null default false,
  add column attendance_intent_enabled boolean not null default false,
  add column fairness_placement_enabled boolean not null default false,
  add column arrival_buffer_minutes integer not null default 15
    check (arrival_buffer_minutes between 0 and 120),
  add column early_check_in_minutes integer not null default 30
    check (early_check_in_minutes between 0 and 240),
  add column minimum_travel_lead_minutes integer not null default 30
    check (minimum_travel_lead_minutes between 0 and 240),
  add column estimate_publication_threshold_minutes integer not null default 10
    check (estimate_publication_threshold_minutes between 1 and 120),
  add column max_earlier_shift_minutes integer not null default 15
    check (max_earlier_shift_minutes between 1 and 120),
  add column configured_baseline_minutes integer null
    check (configured_baseline_minutes between 2 and 120),
  add column baseline_source text null
    check (baseline_source in ('clinic_configured', 'historical')),
  add column baseline_validated_at timestamptz null,
  add column baseline_validated_by uuid null,
  add column estimator_shadow_started_at timestamptz null,
  add column parent_estimate_approved_at timestamptz null,
  add column parent_estimate_approved_by uuid null,
  add constraint clinics_baseline_validation_ck check (
    (configured_baseline_minutes is null and baseline_source is null
      and baseline_validated_at is null and baseline_validated_by is null)
    or
    (configured_baseline_minutes is not null and baseline_source is not null
      and baseline_validated_at is not null and baseline_validated_by is not null)
  ),
  add constraint clinics_baseline_validator_fk
    foreign key (baseline_validated_by, id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  add constraint clinics_estimate_approver_fk
    foreign key (parent_estimate_approved_by, id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  add constraint clinics_parent_gate_ck check (
    not parent_estimate_visible
    or (baseline_validated_at is not null
        and parent_estimate_approved_at is not null
        and tracking_estimator_enabled)
  );

comment on column clinic.clinics.parent_estimate_visible is
  'Release flag. Database constraint prevents bypassing baseline and shadow approval.';

alter table clinic.clinic_sessions
  add column expected_start_at timestamptz null,
  add column doctor_arrived_at timestamptz null,
  add column expected_resume_at timestamptz null,
  add column booking_revision bigint not null default 0 check (booking_revision >= 0),
  add column estimator_baseline_minutes integer null
    check (estimator_baseline_minutes between 2 and 120),
  add column estimator_baseline_source text null
    check (estimator_baseline_source in
      ('clinic_configured', 'historical', 'product_default'));

alter table clinic.appointments
  add column attendance_intent text not null default 'unknown'
    check (attendance_intent in ('unknown', 'coming', 'not_coming')),
  add column attendance_intent_set_at timestamptz null,
  add column attendance_intent_set_by_auth_user_id uuid null,
  add constraint appointments_attendance_fact_ck check (
    (attendance_intent = 'unknown' and attendance_intent_set_at is null)
    or (attendance_intent <> 'unknown' and attendance_intent_set_at is not null)
  );

alter table clinic.queue_entries
  add column fairness_anchor_at timestamptz null,
  add column service_eligible_at timestamptz null,
  add column order_override_at timestamptz null;

create index queue_entries_service_eligible_idx
  on clinic.queue_entries (session_id, service_eligible_at, priority, sort_key)
  where status = 'waiting';

create table clinic.appointment_tracking_state (
  appointment_id uuid primary key,
  clinic_id uuid not null,
  source_session_revision bigint not null default 0,
  source_booking_revision bigint not null default 0,
  published_consultation_from timestamptz null,
  published_consultation_to timestamptz null,
  published_recommended_arrival timestamptz null,
  published_arrival_advice text null
    check (published_arrival_advice in ('arrive_at_time', 'as_soon_as_practical')),
  published_unavailable_reason text null
    check (published_unavailable_reason in
      ('doctor_start_unknown', 'resume_time_unknown', 'pending_approval',
       'session_closed')),
  published_confidence text null
    check (published_confidence in ('low', 'medium', 'high')),
  publication_mode text not null default 'shadow'
    check (publication_mode in ('shadow', 'parent_visible')),
  published_version bigint not null default 0 check (published_version >= 0),
  published_at timestamptz null,
  last_earlier_shift_at timestamptz null,
  updated_at timestamptz not null default now(),

  constraint appointment_tracking_state_appointment_fk
    foreign key (appointment_id, clinic_id)
    references clinic.appointments (id, clinic_id) on delete cascade,
  constraint appointment_tracking_state_shape_ck check (
    (published_unavailable_reason is not null
      and published_consultation_from is null
      and published_consultation_to is null
      and published_recommended_arrival is null
      and published_confidence is null)
    or
    (published_unavailable_reason is null
      and published_consultation_from is not null
      and published_consultation_to is not null
      and published_confidence is not null)
    or
    (published_unavailable_reason is null
      and published_consultation_from is null
      and published_consultation_to is null
      and published_recommended_arrival is null
      and published_arrival_advice is null
      and published_confidence is null)
  )
);

create index appointment_tracking_state_clinic_idx
  on clinic.appointment_tracking_state (clinic_id, updated_at desc);

create trigger appointment_tracking_state_set_updated_at
  before update on clinic.appointment_tracking_state
  for each row execute function clinic.set_updated_at();

create table clinic.appointment_tracking_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  appointment_id uuid not null,
  event_type text not null check (event_type in
    ('shadow_published', 'parent_published', 'capability_issued',
     'capability_rotated', 'capability_revoked', 'attendance_changed')),
  published_version bigint null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint appointment_tracking_events_appointment_fk
    foreign key (appointment_id, clinic_id)
    references clinic.appointments (id, clinic_id) on delete cascade
);

create index appointment_tracking_events_appointment_idx
  on clinic.appointment_tracking_events (appointment_id, created_at desc);
create index appointment_tracking_events_clinic_idx
  on clinic.appointment_tracking_events (clinic_id, created_at desc);

create table clinic.appointment_tracking_capabilities (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  appointment_id uuid not null,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  issued_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  replaced_by_capability_id uuid null,
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  constraint appointment_tracking_capability_expiry_ck check (
    expires_at > issued_at and absolute_expires_at > issued_at
    and expires_at <= absolute_expires_at
  ),
  constraint appointment_tracking_capability_appointment_fk
    foreign key (appointment_id, clinic_id)
    references clinic.appointments (id, clinic_id) on delete cascade,
  constraint appointment_tracking_capability_member_fk
    foreign key (created_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint appointment_tracking_capability_replacement_fk
    foreign key (replaced_by_capability_id)
    references clinic.appointment_tracking_capabilities (id) on delete restrict
);

create unique index appointment_tracking_capability_token_uq
  on clinic.appointment_tracking_capabilities (token_hash);
create unique index appointment_tracking_capability_one_active_uq
  on clinic.appointment_tracking_capabilities (appointment_id)
  where revoked_at is null;
create index appointment_tracking_capability_expiry_idx
  on clinic.appointment_tracking_capabilities (expires_at)
  where revoked_at is null;

do $$
declare target text;
begin
  foreach target in array array[
    'appointment_tracking_state',
    'appointment_tracking_events',
    'appointment_tracking_capabilities'
  ] loop
    execute format('alter table clinic.%I enable row level security', target);
    execute format('alter table clinic.%I force row level security', target);
    execute format(
      'create policy %I on clinic.%I for all to clinic_api using (true) with check (true)',
      target || '_clinic_api', target);
  end loop;
end
$$;

grant select, insert, update on clinic.appointment_tracking_state to clinic_api;
grant select, insert on clinic.appointment_tracking_events to clinic_api;
grant select, insert, update on clinic.appointment_tracking_capabilities to clinic_api;

grant update(
  tracking_estimator_enabled, reception_estimate_visible,
  parent_estimate_visible, guest_tracking_enabled,
  attendance_intent_enabled, fairness_placement_enabled,
  arrival_buffer_minutes, early_check_in_minutes,
  minimum_travel_lead_minutes, estimate_publication_threshold_minutes,
  max_earlier_shift_minutes, configured_baseline_minutes, baseline_source,
  baseline_validated_at, baseline_validated_by,
  estimator_shadow_started_at, parent_estimate_approved_at,
  parent_estimate_approved_by
) on clinic.clinics to clinic_api;

grant update(
  expected_start_at, doctor_arrived_at, expected_resume_at,
  booking_revision, estimator_baseline_minutes, estimator_baseline_source
) on clinic.clinic_sessions to clinic_api;

grant update(
  attendance_intent, attendance_intent_set_at,
  attendance_intent_set_by_auth_user_id
) on clinic.appointments to clinic_api;

grant update(fairness_anchor_at, service_eligible_at, order_override_at)
  on clinic.queue_entries to clinic_api;

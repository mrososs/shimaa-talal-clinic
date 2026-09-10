-- Staff inbox and urgent triage. Urgent cases deliberately remain a separate
-- domain from the live Queue; the workflow layer is the only place allowed to
-- accept a case into a session.

create table clinic.message_threads (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null,
  guardian_id           uuid not null,
  child_id              uuid not null,
  contact_name          text not null check (length(btrim(contact_name)) between 1 and 200),
  child_name            text not null check (length(btrim(child_name)) between 1 and 200),
  subject               text not null check (length(btrim(subject)) between 1 and 300),
  status                text not null default 'open' check (status in ('open', 'closed')),
  priority              text not null default 'normal' check (priority in ('normal', 'urgent')),
  assigned_member_id    uuid,
  created_by_member_id  uuid,
  last_message_at       timestamptz not null default now(),
  closed_at             timestamptz,
  closed_by_member_id   uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint message_threads_id_clinic_uq unique (id, clinic_id),
  constraint message_threads_guardian_fk foreign key (guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete restrict,
  constraint message_threads_child_fk foreign key (child_id, clinic_id)
    references clinic.children (id, clinic_id) on delete restrict,
  constraint message_threads_assignee_fk foreign key (assigned_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint message_threads_creator_fk foreign key (created_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint message_threads_closer_fk foreign key (closed_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint message_threads_closed_shape_ck check (
    (status = 'open' and closed_at is null and closed_by_member_id is null) or
    (status = 'closed' and closed_at is not null and closed_by_member_id is not null)
  )
);

create index message_threads_inbox_idx
  on clinic.message_threads (clinic_id, status, priority, last_message_at desc);
create index message_threads_assignee_idx
  on clinic.message_threads (clinic_id, assigned_member_id, last_message_at desc)
  where status = 'open';
create trigger message_threads_set_updated_at before update on clinic.message_threads
  for each row execute function clinic.set_updated_at();

create table clinic.thread_messages (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null,
  thread_id             uuid not null,
  sender_member_id      uuid,
  sender_guardian_id    uuid,
  body                  text not null check (length(btrim(body)) between 1 and 5000),
  client_request_id     uuid,
  created_at            timestamptz not null default now(),

  constraint thread_messages_id_clinic_uq unique (id, clinic_id),
  constraint thread_messages_thread_fk foreign key (thread_id, clinic_id)
    references clinic.message_threads (id, clinic_id) on delete restrict,
  constraint thread_messages_member_fk foreign key (sender_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint thread_messages_guardian_fk foreign key (sender_guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete restrict,
  constraint thread_messages_one_sender_ck check (
    num_nonnulls(sender_member_id, sender_guardian_id) = 1
  ),
  constraint thread_messages_idempotency_uq unique (thread_id, client_request_id)
);

create index thread_messages_timeline_idx
  on clinic.thread_messages (clinic_id, thread_id, created_at, id);

create table clinic.message_thread_reads (
  clinic_id           uuid not null,
  thread_id           uuid not null,
  member_id           uuid not null,
  last_read_at        timestamptz not null default now(),
  primary key (thread_id, member_id),
  constraint message_thread_reads_thread_fk foreign key (thread_id, clinic_id)
    references clinic.message_threads (id, clinic_id) on delete cascade,
  constraint message_thread_reads_member_fk foreign key (member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict
);

create table clinic.quick_reply_templates (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinic.clinics (id) on delete restrict,
  title       text not null check (length(btrim(title)) between 1 and 120),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  active      boolean not null default true,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index quick_reply_templates_active_idx
  on clinic.quick_reply_templates (clinic_id, sort_order, title) where active;
create trigger quick_reply_templates_set_updated_at before update on clinic.quick_reply_templates
  for each row execute function clinic.set_updated_at();

create table clinic.urgent_cases (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null,
  thread_id             uuid not null,
  child_id              uuid not null,
  guardian_id           uuid not null,
  status                text not null default 'pending'
                          check (status in ('pending', 'accepted', 'rejected')),
  triage_note           text not null check (length(btrim(triage_note)) between 1 and 5000),
  raised_by_member_id   uuid not null,
  decided_by_member_id  uuid,
  decision_note         text,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),

  constraint urgent_cases_id_clinic_uq unique (id, clinic_id),
  constraint urgent_cases_thread_uq unique (thread_id),
  constraint urgent_cases_thread_fk foreign key (thread_id, clinic_id)
    references clinic.message_threads (id, clinic_id) on delete restrict,
  constraint urgent_cases_child_fk foreign key (child_id, clinic_id)
    references clinic.children (id, clinic_id) on delete restrict,
  constraint urgent_cases_guardian_fk foreign key (guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete restrict,
  constraint urgent_cases_raiser_fk foreign key (raised_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint urgent_cases_decider_fk foreign key (decided_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint urgent_cases_decision_shape_ck check (
    (status = 'pending' and decided_by_member_id is null and resolved_at is null) or
    (status <> 'pending' and decided_by_member_id is not null and resolved_at is not null)
  )
);
create index urgent_cases_pending_idx
  on clinic.urgent_cases (clinic_id, created_at) where status = 'pending';

create table clinic.message_events (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null,
  thread_id        uuid not null,
  event_type       text not null check (event_type in (
    'created', 'replied', 'read', 'assigned', 'closed', 'reopened',
    'urgent_raised', 'urgent_accepted', 'urgent_rejected'
  )),
  actor_member_id  uuid not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint message_events_thread_fk foreign key (thread_id, clinic_id)
    references clinic.message_threads (id, clinic_id) on delete restrict,
  constraint message_events_actor_fk foreign key (actor_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict
);
create index message_events_thread_idx
  on clinic.message_events (clinic_id, thread_id, created_at, id);

create table clinic.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinic.clinics (id) on delete restrict,
  kind            text not null,
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts        smallint not null default 0 check (attempts >= 0),
  available_at    timestamptz not null default now(),
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index notification_outbox_pending_idx
  on clinic.notification_outbox (available_at, created_at) where status = 'pending';

do $$
declare target text;
begin
  foreach target in array array[
    'message_threads', 'thread_messages', 'message_thread_reads',
    'quick_reply_templates', 'urgent_cases', 'message_events',
    'notification_outbox'
  ] loop
    execute format('alter table clinic.%I enable row level security', target);
    execute format('alter table clinic.%I force row level security', target);
    execute format(
      'create policy %I on clinic.%I for all to clinic_api using (true) with check (true)',
      target || '_clinic_api', target);
  end loop;
end $$;

grant select, insert, update on clinic.message_threads to clinic_api;
grant select, insert on clinic.thread_messages to clinic_api;
grant select, insert, update on clinic.message_thread_reads to clinic_api;
grant select, insert, update on clinic.quick_reply_templates to clinic_api;
grant select, insert, update on clinic.urgent_cases to clinic_api;
grant select, insert on clinic.message_events to clinic_api;
grant select, insert, update on clinic.notification_outbox to clinic_api;

-- Allow the existing staff inbox to be used by the owning guardian without
-- inventing a clinic member identity for a parent. The API remains the only
-- caller of the private clinic schema; these columns preserve an explicit,
-- auditable actor on every event.

alter table clinic.message_threads
  add column client_request_id uuid,
  add column guardian_last_read_at timestamptz not null default now();

create unique index message_threads_guardian_request_uq
  on clinic.message_threads (guardian_id, client_request_id)
  where client_request_id is not null;

create index message_threads_guardian_timeline_idx
  on clinic.message_threads (clinic_id, guardian_id, last_message_at desc);

alter table clinic.message_events
  add column actor_guardian_id uuid,
  alter column actor_member_id drop not null,
  add constraint message_events_actor_guardian_fk
    foreign key (actor_guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete restrict,
  add constraint message_events_one_actor_ck
    check (num_nonnulls(actor_member_id, actor_guardian_id) = 1);

alter table clinic.urgent_cases
  add column raised_by_guardian_id uuid,
  alter column raised_by_member_id drop not null,
  add constraint urgent_cases_raiser_guardian_fk
    foreign key (raised_by_guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete restrict,
  add constraint urgent_cases_one_raiser_ck
    check (num_nonnulls(raised_by_member_id, raised_by_guardian_id) = 1);

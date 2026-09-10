-- Provider-neutral clinic payments. Cash is recorded as paid; InstaPay starts
-- pending behind a private receipt and requires an explicit staff decision.

create unique index if not exists appointments_id_clinic_child_guardian_uq
  on clinic.appointments (id, clinic_id, child_id, guardian_id);

create table clinic.payments (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null,
  appointment_id        uuid not null,
  child_id              uuid not null,
  guardian_id           uuid not null,
  method                text not null check (method in ('cash', 'instapay')),
  status                text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
  amount_minor          integer not null check (amount_minor > 0),
  currency              text not null default 'EGP' check (currency ~ '^[A-Z]{3}$'),
  idempotency_key       uuid not null,
  receipt_object_path   text unique,
  receipt_file_name     text,
  receipt_mime_type     text check (receipt_mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  receipt_size_bytes    integer check (receipt_size_bytes between 1 and 5242880),
  storage_status        text not null default 'ready' check (storage_status in ('pending', 'ready')),
  recorded_by_member_id uuid not null,
  decided_by_member_id  uuid,
  decision_note         text check (char_length(decision_note) <= 2000),
  paid_at               timestamptz,
  refunded_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint payments_id_clinic_uq unique (id, clinic_id),
  constraint payments_idempotency_uq unique (clinic_id, idempotency_key),
  constraint payments_appointment_identity_fk
    foreign key (appointment_id, clinic_id, child_id, guardian_id)
    references clinic.appointments (id, clinic_id, child_id, guardian_id) on delete restrict,
  constraint payments_recorder_fk foreign key (recorded_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint payments_decider_fk foreign key (decided_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint payments_receipt_shape_ck check (
    (method = 'cash' and storage_status = 'ready' and num_nonnulls(receipt_object_path, receipt_file_name, receipt_mime_type, receipt_size_bytes) = 0)
    or
    (method = 'instapay' and num_nonnulls(receipt_object_path, receipt_file_name, receipt_mime_type, receipt_size_bytes) = 4)
  ),
  constraint payments_status_shape_ck check (
    (status = 'pending' and paid_at is null and refunded_at is null)
    or (status = 'paid' and paid_at is not null and refunded_at is null)
    or (status = 'failed' and paid_at is null and refunded_at is null)
    or (status = 'refunded' and paid_at is not null and refunded_at is not null)
  )
);

create index payments_clinic_status_created_idx
  on clinic.payments (clinic_id, status, created_at desc);
create index payments_appointment_idx
  on clinic.payments (clinic_id, appointment_id, created_at desc);
create trigger payments_set_updated_at before update on clinic.payments
  for each row execute function clinic.set_updated_at();

create table clinic.payment_events (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null,
  payment_id       uuid not null,
  event_type       text not null check (event_type in (
    'cash_registered', 'receipt_uploaded', 'approved', 'rejected', 'refunded'
  )),
  from_status      text,
  to_status        text not null,
  actor_member_id  uuid not null,
  note             text check (char_length(note) <= 2000),
  created_at       timestamptz not null default now(),
  constraint payment_events_payment_fk foreign key (payment_id, clinic_id)
    references clinic.payments (id, clinic_id) on delete restrict,
  constraint payment_events_actor_fk foreign key (actor_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict
);
create index payment_events_payment_idx
  on clinic.payment_events (clinic_id, payment_id, created_at, id);

-- The reporting workflow filters these operational facts by date/status.
create index if not exists appointments_report_idx
  on clinic.appointments (clinic_id, window_start, status, visit_type);
create index if not exists queue_entries_report_idx
  on clinic.queue_entries (clinic_id, checked_in_at, status, called_at, started_at, completed_at);

alter table clinic.payments enable row level security;
alter table clinic.payments force row level security;
alter table clinic.payment_events enable row level security;
alter table clinic.payment_events force row level security;
create policy payments_clinic_api on clinic.payments for all to clinic_api
  using (true) with check (true);
create policy payment_events_clinic_api on clinic.payment_events for all to clinic_api
  using (true) with check (true);

grant select, insert, update on clinic.payments to clinic_api;
grant select, insert on clinic.payment_events to clinic_api;

insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('clinic-payment-receipts', 'clinic-payment-receipts', false, 5242880,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

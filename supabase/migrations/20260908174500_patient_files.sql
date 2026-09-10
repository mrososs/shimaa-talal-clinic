-- Private patient attachments. The browser never receives the service key and
-- never reads clinic.patient_files directly; NestJS authorises every request.

create unique index if not exists clinic_members_id_clinic_uq
  on clinic.clinic_members (id, clinic_id);

create table clinic.patient_files (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null,
  child_id              uuid not null,
  object_path           text not null unique,
  file_name             text not null check (char_length(file_name) between 1 and 255),
  mime_type             text not null check (
                          mime_type in ('application/pdf', 'image/jpeg',
                                        'image/png', 'image/webp')),
  size_bytes            integer not null check (size_bytes between 1 and 10485760),
  status                text not null default 'pending'
                          check (status in ('pending', 'ready')),
  uploaded_by_member_id uuid not null,
  created_at            timestamptz not null default now(),

  constraint patient_files_child_clinic_fk
    foreign key (child_id, clinic_id)
    references clinic.children (id, clinic_id) on delete restrict,
  constraint patient_files_uploader_clinic_fk
    foreign key (uploaded_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict
);

create index patient_files_child_idx
  on clinic.patient_files (clinic_id, child_id, created_at desc)
  where status = 'ready';

create index patient_files_uploader_idx
  on clinic.patient_files (uploaded_by_member_id);

alter table clinic.patient_files enable row level security;
alter table clinic.patient_files force row level security;

create policy patient_files_clinic_api
  on clinic.patient_files for all to clinic_api
  using (true) with check (true);

grant select, insert, update, delete on clinic.patient_files to clinic_api;

-- A private bucket. Only the server's secret-key client writes or signs reads;
-- no authenticated/anon storage policy is created.
insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('clinic-patient-files', 'clinic-patient-files', false, 10485760,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Revocable capability links for a queue entry. The browser receives the raw
-- random token once; PostgreSQL stores only its SHA-256 digest.
create unique index if not exists queue_entries_id_clinic_uq
  on clinic.queue_entries (id, clinic_id);

create table clinic.queue_guest_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  queue_entry_id uuid not null,
  token_hash bytea not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),

  constraint queue_guest_links_token_hash_ck
    check (octet_length(token_hash) = 32),
  constraint queue_guest_links_expiry_ck
    check (expires_at > created_at),
  constraint queue_guest_links_entry_fk
    foreign key (queue_entry_id, clinic_id)
    references clinic.queue_entries (id, clinic_id) on delete cascade,
  constraint queue_guest_links_member_fk
    foreign key (created_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id)
);

create unique index queue_guest_links_token_uq
  on clinic.queue_guest_links (token_hash);

create unique index queue_guest_links_one_active_uq
  on clinic.queue_guest_links (queue_entry_id)
  where revoked_at is null;

create index queue_guest_links_expiry_idx
  on clinic.queue_guest_links (expires_at)
  where revoked_at is null;

alter table clinic.queue_guest_links enable row level security;
alter table clinic.queue_guest_links force row level security;

create policy queue_guest_links_api
  on clinic.queue_guest_links
  for all
  to clinic_api
  using (true)
  with check (true);

grant select, insert, update, delete
  on clinic.queue_guest_links
  to clinic_api;

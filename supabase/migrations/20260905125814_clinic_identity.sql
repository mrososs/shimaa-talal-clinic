-- Clinic identity and tenancy — the first domain migration.
--
-- Creates the schema every later migration builds on: the tenant, its staff,
-- and the guardian/child identity that Booking and Queue both need.
--
-- Three decisions are load-bearing and are explained where they appear:
--
--   1. Everything lives in a `clinic` schema, NOT `public`. `public` is exposed
--      through the Data API, and both frontends hold a publishable key.
--   2. `guardians.auth_user_id` is nullable. Reception must be able to create a
--      family, book it and serve it before that family ever installs the app.
--   3. Guardians link to children through a join table, not a column. A child
--      has a mother and a father, and often a grandparent who brings them in.
--
-- Written against docs/database.md, which specifies the RLS and grant posture.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

create schema if not exists clinic;

comment on schema clinic is
  'Clinic domain data. Deliberately absent from config.toml [api].schemas so '
  'PostgREST cannot reach it with a publishable key.';

-- Postgres grants USAGE on a new schema to nobody, but be explicit: the point
-- of this schema is that no role reaches it without being named.
revoke all on schema clinic from public;

-- ---------------------------------------------------------------------------
-- The API's own role
--
-- docs/database.md: the API connects as a dedicated least-privilege role, never
-- as `postgres` or the table owner. It gets no password here — that would put a
-- credential in version control. The password is set out of band, and the role
-- cannot authenticate until it is.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'clinic_api') then
    create role clinic_api login;
  end if;
end
$$;

-- citext's operators live in `extensions`; without it on the search path a
-- comparison against a citext column fails to resolve an operator.
alter role clinic_api set search_path = clinic, public, extensions;

-- ---------------------------------------------------------------------------
-- Shared plumbing
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER (the default) on purpose. A SECURITY DEFINER trigger would
-- run as the owner and bypass RLS for no reason.
create or replace function clinic.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A bad timezone silently corrupts every "today" the platform computes, and the
-- clinic's day boundary is the one thing the whole schedule hangs from. It is
-- not expressible as a CHECK, because the lookup is not immutable.
create or replace function clinic.assert_valid_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'unknown timezone: %', new.timezone
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- clinics — the tenant root
-- ---------------------------------------------------------------------------

create table clinic.clinics (
  id                           uuid primary key default gen_random_uuid(),
  name                         text not null check (length(btrim(name)) > 0),
  slug                         text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),

  -- The clinic's day boundary. Never the server's, never the viewer's.
  timezone                     text not null default 'Africa/Cairo',
  -- ISO 3166-1 alpha-2. The region @clinic/phone normalises against.
  default_country_code         text not null default 'EG'
                                 check (default_country_code ~ '^[A-Z]{2}$'),

  -- Operating policy. Every one of these is a number the clinic may change, so
  -- none of them is a constant in code.
  grace_period_minutes         integer  not null default 10
                                 check (grace_period_minutes between 1 and 120),
  default_avg_consult_minutes  integer  not null default 6
                                 check (default_avg_consult_minutes between 1 and 240),
  max_self_defers              smallint not null default 2
                                 check (max_self_defers between 0 and 10),
  min_lead_minutes             integer  not null default 0
                                 check (min_lead_minutes >= 0),
  cancellation_cutoff_minutes  integer  not null default 120
                                 check (cancellation_cutoff_minutes >= 0),

  -- False means a parent's booking lands as `requested` and staff approve it.
  -- A column, not a code path, so the decision is reversible without a release.
  auto_confirm_parent_bookings boolean not null default false,

  active                       boolean not null default true,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create unique index clinics_slug_uq on clinic.clinics (slug);

create trigger clinics_set_updated_at
  before update on clinic.clinics
  for each row execute function clinic.set_updated_at();

create trigger clinics_assert_timezone
  before insert or update of timezone on clinic.clinics
  for each row execute function clinic.assert_valid_timezone();

comment on table clinic.clinics is 'Tenant root. Every other table carries clinic_id.';

-- ---------------------------------------------------------------------------
-- clinic_members — staff
-- ---------------------------------------------------------------------------

create table clinic.clinic_members (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinic.clinics (id) on delete restrict,

  -- Staff must have an account; unlike guardians, this is not optional.
  --
  -- ON DELETE RESTRICT, not CASCADE: member rows are the audit trail for who
  -- booked, checked in and called every patient. Deleting an auth user must not
  -- quietly erase that. Offboarding is `status = 'suspended'`, which the API
  -- guard already refuses.
  auth_user_id uuid not null references auth.users (id) on delete restrict,

  role         text not null check (role in ('doctor', 'reception', 'admin')),
  display_name text not null check (length(btrim(display_name)) > 0),
  status       text not null default 'active'
                 check (status in ('active', 'suspended')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index clinic_members_clinic_user_uq
  on clinic.clinic_members (clinic_id, auth_user_id);

-- The lookup on every single authenticated staff request.
create index clinic_members_auth_user_idx
  on clinic.clinic_members (auth_user_id);

create index clinic_members_clinic_role_idx
  on clinic.clinic_members (clinic_id, role) where status = 'active';

create trigger clinic_members_set_updated_at
  before update on clinic.clinic_members
  for each row execute function clinic.set_updated_at();

-- ---------------------------------------------------------------------------
-- guardians — parents and caregivers, as the clinic knows them
-- ---------------------------------------------------------------------------

create table clinic.guardians (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinic.clinics (id) on delete restrict,

  -- NULLABLE BY DESIGN, and the most important nullable column in the schema.
  -- Reception creates guardians for families who have never installed the app;
  -- those families must still be bookable and servable. Nothing in Booking or
  -- Queue may require this to be set.
  --
  -- ON DELETE SET NULL: if the auth account goes away the family survives,
  -- unclaimed, and reception carries on as before.
  auth_user_id         uuid references auth.users (id) on delete set null,

  full_name            text not null check (length(btrim(full_name)) > 0),

  -- The clinic's lookup key. E.164 only — normalisation happens once, at the
  -- API boundary, in @clinic/phone. This check is the backstop, not the rule.
  phone_e164           text not null check (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  -- What the receptionist actually typed, kept for support conversations.
  phone_raw            text,

  email                extensions.citext,
  default_relationship text check (
                         default_relationship in
                         ('mother', 'father', 'grandparent', 'other')),

  claimed_at           timestamptz,
  claimed_via          text check (
                         claimed_via in ('claim_code', 'self_signup', 'phone_otp')),

  -- NULL means the guardian registered themselves.
  created_by_member_id uuid references clinic.clinic_members (id) on delete set null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- A linked account and the record of how it was linked travel together, so a
  -- claimed guardian can never lose its provenance.
  constraint guardians_claim_consistent check (
    (auth_user_id is null     and claimed_at is null     and claimed_via is null) or
    (auth_user_id is not null and claimed_at is not null and claimed_via is not null)
  )
);

-- Phone is the lookup key, so it must be unique per clinic. This is also what
-- stops reception creating a second record for a family that already exists.
create unique index guardians_clinic_phone_uq
  on clinic.guardians (clinic_id, phone_e164);

-- One auth user is one guardian within a clinic. Partial, because unclaimed
-- guardians all share a NULL and must not collide.
create unique index guardians_clinic_auth_user_uq
  on clinic.guardians (clinic_id, auth_user_id) where auth_user_id is not null;

create index guardians_clinic_name_idx on clinic.guardians (clinic_id, full_name);
create index guardians_created_by_idx  on clinic.guardians (created_by_member_id);

create trigger guardians_set_updated_at
  before update on clinic.guardians
  for each row execute function clinic.set_updated_at();

-- ---------------------------------------------------------------------------
-- children — the patient
-- ---------------------------------------------------------------------------

create table clinic.children (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinic.clinics (id) on delete restrict,

  full_name            text not null check (length(btrim(full_name)) > 0),

  -- Often unknown when reception books over the phone. A lower bound catches a
  -- mistyped year; an upper bound would need current_date, which is not
  -- immutable and so cannot appear in a CHECK — the API validates that.
  date_of_birth        date check (date_of_birth > date '1900-01-01'),
  sex                  text check (sex in ('male', 'female')),

  created_by_member_id uuid references clinic.clinic_members (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index children_clinic_name_idx on clinic.children (clinic_id, full_name);
create index children_created_by_idx  on clinic.children (created_by_member_id);

create trigger children_set_updated_at
  before update on clinic.children
  for each row execute function clinic.set_updated_at();

comment on table clinic.children is
  'Operational patient identity only. Diagnoses, prescriptions, allergies, '
  'vaccinations and growth are a medical record this platform does not hold.';

-- ---------------------------------------------------------------------------
-- guardian_children — the relationship
--
-- A join table rather than children.guardian_id. Both parents commonly hold
-- accounts, and a grandparent is often the one who attends. Adding that later
-- would mean rewriting every child query, every ownership check and every
-- policy; the join costs one table now.
-- ---------------------------------------------------------------------------

create table clinic.guardian_children (
  guardian_id  uuid not null references clinic.guardians (id) on delete cascade,
  child_id     uuid not null references clinic.children (id) on delete cascade,
  relationship text not null check (
                 relationship in ('mother', 'father', 'grandparent', 'other')),
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),

  primary key (guardian_id, child_id)
);

-- Exactly one primary caregiver per child.
create unique index guardian_children_primary_uq
  on clinic.guardian_children (child_id) where is_primary;

-- guardian_id is covered by the primary key; child_id is not.
create index guardian_children_child_idx on clinic.guardian_children (child_id);

comment on table clinic.guardian_children is
  'The ownership predicate for every parent-facing read: a guardian may see a '
  'child only through a row here.';

-- ---------------------------------------------------------------------------
-- guardian_claim_codes — linking an app account to an existing family
--
-- Phone ownership is not verified in this phase, so a matching phone number
-- must never by itself grant access to a family's records. Reception issues a
-- short-lived code instead, in person or on the call.
-- ---------------------------------------------------------------------------

create table clinic.guardian_claim_codes (
  id                       uuid primary key default gen_random_uuid(),
  guardian_id              uuid not null references clinic.guardians (id) on delete cascade,

  -- SHA-256 of the code. The plaintext is shown to staff once and never stored,
  -- so a database leak does not hand over live claim codes.
  code_hash                text not null check (code_hash ~ '^[0-9a-f]{64}$'),

  expires_at               timestamptz not null,
  consumed_at              timestamptz,
  consumed_by_auth_user_id uuid references auth.users (id) on delete set null,

  issued_by_member_id      uuid not null references clinic.clinic_members (id)
                             on delete restrict,
  attempts                 smallint not null default 0 check (attempts >= 0),
  created_at               timestamptz not null default now(),

  constraint claim_codes_consumed_consistent check (
    (consumed_at is null     and consumed_by_auth_user_id is null) or
    (consumed_at is not null and consumed_by_auth_user_id is not null)
  )
);

-- At most one live code per guardian: issuing a new one must first clear the
-- old, which is also what keeps a stale code from being usable.
create unique index guardian_claim_codes_active_uq
  on clinic.guardian_claim_codes (guardian_id) where consumed_at is null;

create index guardian_claim_codes_issued_by_idx
  on clinic.guardian_claim_codes (issued_by_member_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Two locks, and it is worth being honest about what each one does.
--
-- The schema being absent from [api].schemas is what actually keeps a
-- publishable key away from this data. RLS is the second lock: if someone later
-- exposes the schema, or grants `authenticated` USAGE, every table still denies
-- by default because no policy names those roles.
--
-- FORCE matters because without it the table owner is exempt, and the owner is
-- who migrations run as.
--
-- The clinic_api policies below are deliberately `true`. Authorisation lives in
-- the API in this phase (docs/database.md, option (a): trusted API, RLS as a
-- backstop). These policies are the seam where request-scoped predicates land
-- if that changes — tightened, not added.
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array[
    'clinics', 'clinic_members', 'guardians',
    'children', 'guardian_children', 'guardian_claim_codes'
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

-- ---------------------------------------------------------------------------
-- Grants — explicit and minimal. No GRANT ALL, and no CREATE: schema changes
-- come from migrations, not from the running application.
-- ---------------------------------------------------------------------------

grant usage on schema clinic to clinic_api;

-- Clinics are provisioned by migration. The app reads them and may update
-- policy; it never creates or deletes a tenant.
grant select, update                 on clinic.clinics              to clinic_api;

-- Staff are added and suspended, never deleted — the audit trail depends on
-- their rows surviving.
grant select, insert, update         on clinic.clinic_members       to clinic_api;

-- Families are created and corrected, never deleted. A visit history that
-- outlives its patient record is worse than a stale row.
grant select, insert, update         on clinic.guardians            to clinic_api;
grant select, insert, update         on clinic.children             to clinic_api;

-- Unlinking a caregiver from a child is a legitimate correction.
grant select, insert, update, delete on clinic.guardian_children    to clinic_api;

-- Claim codes are ephemeral by design.
grant select, insert, update, delete on clinic.guardian_claim_codes to clinic_api;

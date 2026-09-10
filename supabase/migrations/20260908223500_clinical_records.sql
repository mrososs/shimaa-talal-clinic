-- Doctor-owned encounter drafts/final records plus reception-safe measurements.
-- Immutable versions make every clinical edit attributable and recoverable.

create unique index if not exists appointments_id_clinic_child_uq
  on clinic.appointments (id, clinic_id, child_id);

create table clinic.clinical_encounters (
  id                     uuid primary key default gen_random_uuid(),
  clinic_id              uuid not null,
  appointment_id         uuid not null,
  child_id               uuid not null,
  status                 text not null default 'draft'
                           check (status in ('draft', 'final')),
  diagnosis              text not null default '' check (char_length(diagnosis) <= 20000),
  investigations         text not null default '' check (char_length(investigations) <= 20000),
  treatment_instructions text not null default '' check (char_length(treatment_instructions) <= 20000),
  growth_observation     text not null default '' check (char_length(growth_observation) <= 10000),
  follow_up_days         smallint check (follow_up_days between 1 and 365),
  parent_summary         text not null default '' check (char_length(parent_summary) <= 20000),
  revision               integer not null default 1 check (revision > 0),
  created_by_member_id   uuid not null,
  updated_by_member_id   uuid not null,
  finalized_by_member_id uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  finalized_at           timestamptz,

  constraint clinical_encounters_id_clinic_uq unique (id, clinic_id),
  constraint clinical_encounters_appointment_uq unique (appointment_id),
  constraint clinical_encounters_appointment_child_fk
    foreign key (appointment_id, clinic_id, child_id)
    references clinic.appointments (id, clinic_id, child_id) on delete restrict,
  constraint clinical_encounters_creator_fk
    foreign key (created_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint clinical_encounters_updater_fk
    foreign key (updated_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint clinical_encounters_finalizer_fk
    foreign key (finalized_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict,
  constraint clinical_encounters_final_shape_ck check (
    (status = 'draft' and finalized_at is null and finalized_by_member_id is null)
    or
    (status = 'final' and finalized_at is not null and finalized_by_member_id is not null)
  )
);

create index clinical_encounters_child_idx
  on clinic.clinical_encounters (clinic_id, child_id, finalized_at desc);

create table clinic.clinical_encounter_versions (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null,
  encounter_id  uuid not null,
  revision      integer not null,
  action        text not null check (action in ('draft_saved', 'finalized')),
  snapshot      jsonb not null,
  actor_member_id uuid not null,
  created_at    timestamptz not null default now(),

  constraint clinical_encounter_versions_uq unique (encounter_id, revision),
  constraint clinical_encounter_versions_encounter_fk
    foreign key (encounter_id, clinic_id)
    references clinic.clinical_encounters (id, clinic_id) on delete restrict,
  constraint clinical_encounter_versions_actor_fk
    foreign key (actor_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict
);

create index clinical_encounter_versions_clinic_idx
  on clinic.clinical_encounter_versions (clinic_id, encounter_id, revision desc);

create table clinic.clinical_measurements (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null,
  child_id              uuid not null,
  appointment_id        uuid,
  weight_kg             numeric(5,2) check (weight_kg between 0.2 and 300),
  height_cm             numeric(5,2) check (height_cm between 20 and 250),
  head_circumference_cm numeric(5,2) check (head_circumference_cm between 15 and 100),
  temperature_c         numeric(4,1) check (temperature_c between 30 and 45),
  measured_at           timestamptz not null default now(),
  recorded_by_member_id uuid not null,

  constraint clinical_measurements_has_value_ck check (
    num_nonnulls(weight_kg, height_cm, head_circumference_cm, temperature_c) > 0
  ),
  constraint clinical_measurements_child_fk
    foreign key (child_id, clinic_id)
    references clinic.children (id, clinic_id) on delete restrict,
  constraint clinical_measurements_appointment_fk
    foreign key (appointment_id, clinic_id, child_id)
    references clinic.appointments (id, clinic_id, child_id) on delete restrict,
  constraint clinical_measurements_recorder_fk
    foreign key (recorded_by_member_id, clinic_id)
    references clinic.clinic_members (id, clinic_id) on delete restrict
);

create index clinical_measurements_child_idx
  on clinic.clinical_measurements (clinic_id, child_id, measured_at desc);

alter table clinic.clinical_encounters enable row level security;
alter table clinic.clinical_encounters force row level security;
alter table clinic.clinical_encounter_versions enable row level security;
alter table clinic.clinical_encounter_versions force row level security;
alter table clinic.clinical_measurements enable row level security;
alter table clinic.clinical_measurements force row level security;

create policy clinical_encounters_clinic_api
  on clinic.clinical_encounters for all to clinic_api
  using (true) with check (true);
create policy clinical_encounter_versions_clinic_api
  on clinic.clinical_encounter_versions for all to clinic_api
  using (true) with check (true);
create policy clinical_measurements_clinic_api
  on clinic.clinical_measurements for all to clinic_api
  using (true) with check (true);

grant select, insert, update on clinic.clinical_encounters to clinic_api;
grant select, insert on clinic.clinical_encounter_versions to clinic_api;
grant select, insert on clinic.clinical_measurements to clinic_api;

-- A UUID identifies a row globally, but every operational reference also
-- carries clinic_id. Composite foreign keys make the database prove those two
-- facts agree instead of relying on every caller to remember the tenant check.

create unique index if not exists guardians_id_clinic_uq
  on clinic.guardians (id, clinic_id);
create unique index if not exists children_id_clinic_uq
  on clinic.children (id, clinic_id);
create unique index if not exists clinic_sessions_id_clinic_uq
  on clinic.clinic_sessions (id, clinic_id);
create unique index if not exists appointments_id_clinic_uq
  on clinic.appointments (id, clinic_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_session_clinic_fk'
      and conrelid = 'clinic.appointments'::regclass
  ) then
    alter table clinic.appointments
      add constraint appointments_session_clinic_fk
      foreign key (session_id, clinic_id)
      references clinic.clinic_sessions (id, clinic_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_child_clinic_fk'
      and conrelid = 'clinic.appointments'::regclass
  ) then
    alter table clinic.appointments
      add constraint appointments_child_clinic_fk
      foreign key (child_id, clinic_id)
      references clinic.children (id, clinic_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_guardian_clinic_fk'
      and conrelid = 'clinic.appointments'::regclass
  ) then
    alter table clinic.appointments
      add constraint appointments_guardian_clinic_fk
      foreign key (guardian_id, clinic_id)
      references clinic.guardians (id, clinic_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_rescheduled_from_clinic_fk'
      and conrelid = 'clinic.appointments'::regclass
  ) then
    alter table clinic.appointments
      add constraint appointments_rescheduled_from_clinic_fk
      foreign key (rescheduled_from_appointment_id, clinic_id)
      references clinic.appointments (id, clinic_id) on delete restrict;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'queue_entries_session_clinic_fk'
      and conrelid = 'clinic.queue_entries'::regclass
  ) then
    alter table clinic.queue_entries
      add constraint queue_entries_session_clinic_fk
      foreign key (session_id, clinic_id)
      references clinic.clinic_sessions (id, clinic_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'queue_entries_appointment_clinic_fk'
      and conrelid = 'clinic.queue_entries'::regclass
  ) then
    alter table clinic.queue_entries
      add constraint queue_entries_appointment_clinic_fk
      foreign key (appointment_id, clinic_id)
      references clinic.appointments (id, clinic_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'queue_entries_child_clinic_fk'
      and conrelid = 'clinic.queue_entries'::regclass
  ) then
    alter table clinic.queue_entries
      add constraint queue_entries_child_clinic_fk
      foreign key (child_id, clinic_id)
      references clinic.children (id, clinic_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'queue_entries_guardian_clinic_fk'
      and conrelid = 'clinic.queue_entries'::regclass
  ) then
    alter table clinic.queue_entries
      add constraint queue_entries_guardian_clinic_fk
      foreign key (guardian_id, clinic_id)
      references clinic.guardians (id, clinic_id) on delete restrict;
  end if;
end
$$;

-- Guardian payment choices use the same ledger as staff collection while
-- preserving who actually performed the action. Amount, currency, child and
-- guardian remain server-derived from the owned appointment.

alter table clinic.payments
  add column recorded_by_guardian_id uuid,
  alter column recorded_by_member_id drop not null,
  add constraint payments_recorder_guardian_fk
    foreign key (recorded_by_guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete restrict,
  add constraint payments_one_recorder_ck
    check (
      num_nonnulls(recorded_by_member_id, recorded_by_guardian_id) = 1
    );

create index payments_guardian_created_idx
  on clinic.payments (clinic_id, guardian_id, created_at desc)
  where storage_status = 'ready';

create unique index payments_one_active_appointment_uq
  on clinic.payments (appointment_id)
  where status in ('pending', 'paid');

alter table clinic.payment_events
  drop constraint payment_events_event_type_check,
  add constraint payment_events_event_type_check
    check (event_type in (
      'cash_selected', 'cash_registered', 'receipt_uploaded',
      'approved', 'rejected', 'refunded'
    )),
  add column actor_guardian_id uuid,
  alter column actor_member_id drop not null,
  add constraint payment_events_actor_guardian_fk
    foreign key (actor_guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete restrict,
  add constraint payment_events_one_actor_ck
    check (num_nonnulls(actor_member_id, actor_guardian_id) = 1);

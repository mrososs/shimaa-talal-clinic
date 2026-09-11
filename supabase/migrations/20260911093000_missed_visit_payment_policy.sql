-- Keep money attached to the visit it pays for when an appointment is moved,
-- and record cash promises that end because the family missed the visit.

alter table clinic.payment_events
  drop constraint payment_events_event_type_check,
  add constraint payment_events_event_type_check
    check (event_type in (
      'cash_selected', 'cash_registered', 'receipt_uploaded',
      'approved', 'rejected', 'refunded',
      'transferred', 'voided_no_show'
    )),
  add column from_appointment_id uuid,
  add column to_appointment_id uuid,
  add constraint payment_events_transfer_shape_ck
    check (
      (event_type = 'transferred'
        and from_appointment_id is not null
        and to_appointment_id is not null)
      or
      (event_type <> 'transferred'
        and from_appointment_id is null
        and to_appointment_id is null)
    ),
  add constraint payment_events_from_appointment_fk
    foreign key (from_appointment_id, clinic_id)
    references clinic.appointments (id, clinic_id) on delete restrict,
  add constraint payment_events_to_appointment_fk
    foreign key (to_appointment_id, clinic_id)
    references clinic.appointments (id, clinic_id) on delete restrict;

create index payment_events_transfer_from_idx
  on clinic.payment_events (clinic_id, from_appointment_id)
  where from_appointment_id is not null;

create index payment_events_transfer_to_idx
  on clinic.payment_events (clinic_id, to_appointment_id)
  where to_appointment_id is not null;

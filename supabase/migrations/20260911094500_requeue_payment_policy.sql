-- A missed patient can return to today's queue. If their uncollected cash
-- promise was closed on no-show, reopen the same record rather than inventing
-- another payment.

alter table clinic.payment_events
  drop constraint payment_events_event_type_check,
  add constraint payment_events_event_type_check
    check (event_type in (
      'cash_selected', 'cash_registered', 'receipt_uploaded',
      'approved', 'rejected', 'refunded',
      'transferred', 'voided_no_show', 'restored_after_requeue'
    ));

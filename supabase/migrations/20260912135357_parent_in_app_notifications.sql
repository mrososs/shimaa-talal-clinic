-- Guardian-scoped, durable in-app notifications. The event triggers below run
-- inside the mutation transaction, so a rollback cannot leave a notification
-- for a state change that never committed. Browser clients still reach these
-- rows only through the trusted Nest API.

create table clinic.guardian_notifications (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null,
  guardian_id     uuid not null,
  kind            text not null check (kind in (
    'appointment_confirmed', 'appointment_cancelled', 'appointment_no_show',
    'appointment_completed', 'queue_called', 'queue_missed', 'queue_requeued',
    'payment_approved', 'payment_rejected', 'payment_refunded',
    'message_reply', 'urgent_accepted', 'urgent_rejected'
  )),
  title           text not null check (char_length(btrim(title)) between 1 and 120),
  body            text not null check (char_length(btrim(body)) between 1 and 280),
  deep_link       text not null check (deep_link like '/%'),
  source_type     text not null check (source_type in (
    'appointment_event', 'queue_event', 'payment_event', 'message_event'
  )),
  source_event_id uuid not null,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),

  constraint guardian_notifications_guardian_fk
    foreign key (guardian_id, clinic_id)
    references clinic.guardians (id, clinic_id) on delete cascade,
  constraint guardian_notifications_source_uq
    unique (source_type, source_event_id)
);

create index guardian_notifications_timeline_idx
  on clinic.guardian_notifications (clinic_id, guardian_id, created_at desc, id desc);

create index guardian_notifications_unread_idx
  on clinic.guardian_notifications (clinic_id, guardian_id, created_at desc)
  where read_at is null;

alter table clinic.guardian_notifications enable row level security;
alter table clinic.guardian_notifications force row level security;
create policy guardian_notifications_api_all
  on clinic.guardian_notifications for all to clinic_api
  using (true) with check (true);
grant select, insert, update on clinic.guardian_notifications to clinic_api;

create function clinic.notify_guardian_from_appointment_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_clinic uuid;
  target_guardian uuid;
  notification_kind text;
  notification_title text;
  notification_body text;
begin
  select a.clinic_id, a.guardian_id
    into target_clinic, target_guardian
    from clinic.appointments a
   where a.id = new.appointment_id;

  if new.to_status = 'confirmed' and new.from_status = 'requested' then
    notification_kind := 'appointment_confirmed';
    notification_title := 'تم تأكيد الموعد';
    notification_body := 'وافقت العيادة على طلب الحجز. راجعي تفاصيل الموعد.';
  elsif new.to_status = 'cancelled' then
    notification_kind := 'appointment_cancelled';
    notification_title := case when new.from_status = 'requested'
      then 'تعذّر تأكيد الحجز' else 'تم إلغاء الموعد' end;
    notification_body := case when new.from_status = 'requested'
      then 'راجعي تفاصيل الطلب أو اختاري موعداً آخر.'
      else 'راجعي تفاصيل الموعد لمعرفة حالته الحالية.' end;
  elsif new.to_status = 'no_show' then
    notification_kind := 'appointment_no_show';
    notification_title := 'انتهت مهلة الحضور';
    notification_body := 'تم تسجيل الزيارة كعدم حضور. افتحي الموعد لمعرفة الخيارات المتاحة.';
  elsif new.to_status = 'completed' then
    notification_kind := 'appointment_completed';
    notification_title := 'تم إنهاء الزيارة';
    notification_body := 'اكتملت الزيارة بنجاح ويمكنك مراجعة حالة الموعد.';
  else
    return new;
  end if;

  insert into clinic.guardian_notifications
    (clinic_id, guardian_id, kind, title, body, deep_link,
     source_type, source_event_id, created_at)
  values
    (target_clinic, target_guardian, notification_kind,
     notification_title, notification_body,
     '/appointments/' || new.appointment_id::text,
     'appointment_event', new.id, new.created_at)
  on conflict (source_type, source_event_id) do nothing;
  return new;
end;
$$;

create trigger appointment_event_guardian_notification
  after insert on clinic.appointment_events
  for each row execute function clinic.notify_guardian_from_appointment_event();

create function clinic.notify_guardian_from_queue_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_clinic uuid;
  target_guardian uuid;
  notification_kind text;
  notification_title text;
  notification_body text;
begin
  select q.clinic_id, q.guardian_id
    into target_clinic, target_guardian
    from clinic.queue_entries q
   where q.id = new.entry_id;

  if target_guardian is null then return new; end if;

  if new.event_type = 'called' then
    notification_kind := 'queue_called';
    notification_title := 'حان دورك الآن';
    notification_body := 'توجهي إلى غرفة الكشف خلال مهلة الحضور الظاهرة في الطابور.';
  elsif new.event_type = 'missed' then
    notification_kind := 'queue_missed';
    notification_title := 'انتهت مهلة الدور';
    notification_body := 'افتحي الطابور لمعرفة حالة الزيارة والخيارات المتاحة.';
  elsif new.event_type = 'requeued' then
    notification_kind := 'queue_requeued';
    notification_title := 'عاد الدور إلى الانتظار';
    notification_body := 'تمت إعادة المريض إلى الطابور ويمكن متابعة الترتيب الآن.';
  else
    return new;
  end if;

  insert into clinic.guardian_notifications
    (clinic_id, guardian_id, kind, title, body, deep_link,
     source_type, source_event_id, created_at)
  values
    (target_clinic, target_guardian, notification_kind,
     notification_title, notification_body, '/tabs/queue',
     'queue_event', new.id, new.created_at)
  on conflict (source_type, source_event_id) do nothing;
  return new;
end;
$$;

create trigger queue_event_guardian_notification
  after insert on clinic.queue_events
  for each row execute function clinic.notify_guardian_from_queue_event();

create function clinic.notify_guardian_from_payment_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_guardian uuid;
  target_appointment uuid;
  notification_kind text;
  notification_title text;
  notification_body text;
begin
  select p.guardian_id, p.appointment_id
    into target_guardian, target_appointment
    from clinic.payments p
   where p.id = new.payment_id and p.clinic_id = new.clinic_id;

  if new.event_type = 'approved' then
    notification_kind := 'payment_approved';
    notification_title := 'تم اعتماد الدفع';
    notification_body := 'أكدت العيادة استلام الدفعة بنجاح.';
  elsif new.event_type = 'rejected' then
    notification_kind := 'payment_rejected';
    notification_title := 'تعذّر اعتماد الدفع';
    notification_body := 'راجعي عملية الدفع أو تواصلي مع العيادة.';
  elsif new.event_type = 'refunded' then
    notification_kind := 'payment_refunded';
    notification_title := 'تم تسجيل الاسترداد';
    notification_body := 'حدّثت العيادة حالة الدفعة إلى مستردة.';
  else
    return new;
  end if;

  insert into clinic.guardian_notifications
    (clinic_id, guardian_id, kind, title, body, deep_link,
     source_type, source_event_id, created_at)
  values
    (new.clinic_id, target_guardian, notification_kind,
     notification_title, notification_body,
     '/payments?appointmentId=' || target_appointment::text,
     'payment_event', new.id, new.created_at)
  on conflict (source_type, source_event_id) do nothing;
  return new;
end;
$$;

create trigger payment_event_guardian_notification
  after insert on clinic.payment_events
  for each row execute function clinic.notify_guardian_from_payment_event();

create function clinic.notify_guardian_from_message_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_guardian uuid;
  notification_kind text;
  notification_title text;
  notification_body text;
begin
  select t.guardian_id into target_guardian
    from clinic.message_threads t
   where t.id = new.thread_id and t.clinic_id = new.clinic_id;

  if new.event_type = 'replied' and new.actor_member_id is not null then
    notification_kind := 'message_reply';
    notification_title := 'رد جديد من العيادة';
    notification_body := 'وصل رد جديد على محادثتك مع العيادة.';
  elsif new.event_type = 'urgent_accepted' then
    notification_kind := 'urgent_accepted';
    notification_title := 'تم قبول الحالة العاجلة';
    notification_body := 'قبلت العيادة الحالة وأضيفت إلى الطابور.';
  elsif new.event_type = 'urgent_rejected' then
    notification_kind := 'urgent_rejected';
    notification_title := 'تمت مراجعة الحالة العاجلة';
    notification_body := 'راجعي رد العيادة داخل المحادثة.';
  else
    return new;
  end if;

  insert into clinic.guardian_notifications
    (clinic_id, guardian_id, kind, title, body, deep_link,
     source_type, source_event_id, created_at)
  values
    (new.clinic_id, target_guardian, notification_kind,
     notification_title, notification_body,
     '/tabs/messages?threadId=' || new.thread_id::text,
     'message_event', new.id, new.created_at)
  on conflict (source_type, source_event_id) do nothing;
  return new;
end;
$$;

create trigger message_event_guardian_notification
  after insert on clinic.message_events
  for each row execute function clinic.notify_guardian_from_message_event();

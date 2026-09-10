alter table clinic.clinics
  add column phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  add column address text check (address is null or char_length(address) <= 500);

create table clinic.service_prices (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic.clinics(id) on delete restrict,
  visit_type text not null check (visit_type in ('new_visit','follow_up','vaccination','consultation','newborn')),
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null default 'EGP' check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, visit_type)
);
create trigger service_prices_set_updated_at before update on clinic.service_prices
  for each row execute function clinic.set_updated_at();

create table clinic.notification_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic.clinics(id) on delete restrict,
  template_key text not null check (template_key in ('booking_confirmed','booking_reminder','queue_called','payment_approved')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, template_key)
);
create trigger notification_templates_set_updated_at before update on clinic.notification_templates
  for each row execute function clinic.set_updated_at();

create table clinic.audit_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinic.clinics(id) on delete restrict,
  actor_member_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_fk foreign key(actor_member_id,clinic_id)
    references clinic.clinic_members(id,clinic_id) on delete restrict
);
create index audit_events_clinic_created_idx on clinic.audit_events(clinic_id,created_at desc,id desc);

insert into clinic.service_prices(clinic_id,visit_type,amount_minor)
select c.id,v.visit_type,v.amount_minor from clinic.clinics c cross join
  (values ('new_visit',45000),('follow_up',30000),('vaccination',25000),('consultation',35000),('newborn',50000)) v(visit_type,amount_minor)
on conflict do nothing;
insert into clinic.notification_templates(clinic_id,template_key,body)
select c.id,v.template_key,v.body from clinic.clinics c cross join (values
 ('booking_confirmed','تم تأكيد حجزكم في العيادة.'),
 ('booking_reminder','تذكير بموعدكم القادم في العيادة.'),
 ('queue_called','حان دوركم، برجاء التوجه إلى غرفة الكشف.'),
 ('payment_approved','تم اعتماد عملية الدفع بنجاح.')
) v(template_key,body) on conflict do nothing;

alter table clinic.service_prices enable row level security; alter table clinic.service_prices force row level security;
alter table clinic.notification_templates enable row level security; alter table clinic.notification_templates force row level security;
alter table clinic.audit_events enable row level security; alter table clinic.audit_events force row level security;
create policy service_prices_api on clinic.service_prices for all to clinic_api using(true) with check(true);
create policy notification_templates_api on clinic.notification_templates for all to clinic_api using(true) with check(true);
create policy audit_events_api on clinic.audit_events for all to clinic_api using(true) with check(true);
grant select,insert,update on clinic.service_prices to clinic_api;
grant select,insert,update on clinic.notification_templates to clinic_api;
grant select,insert on clinic.audit_events to clinic_api;
grant update(name,phone_e164,address,grace_period_minutes,default_avg_consult_minutes,max_self_defers,min_lead_minutes,cancellation_cutoff_minutes,auto_confirm_parent_bookings) on clinic.clinics to clinic_api;
grant update(role,status,display_name) on clinic.clinic_members to clinic_api;
grant insert,update on clinic.clinic_schedules to clinic_api;
grant insert on clinic.clinic_closures to clinic_api;

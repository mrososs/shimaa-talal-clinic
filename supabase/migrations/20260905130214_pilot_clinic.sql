-- The pilot tenant.
--
-- A migration rather than seed.sql: every environment needs at least one clinic
-- row before the platform does anything at all, and seed.sql only runs on a
-- local `supabase db reset`. Idempotent, so re-running it is harmless.
--
-- Every value here is clinic policy taken from the prototype, and every one is
-- a column precisely so it can be changed without a release.

insert into clinic.clinics (
  name,
  slug,
  timezone,
  default_country_code,
  grace_period_minutes,
  default_avg_consult_minutes,
  max_self_defers,
  min_lead_minutes,
  cancellation_cutoff_minutes,
  auto_confirm_parent_bookings
)
values (
  'عيادة د. شيماء طلال',
  'shimaa-talal',
  'Africa/Cairo',
  'EG',
  -- "لديك ١٠ دقائق للحضور" on the grace screen.
  10,
  -- "متوسط وقت الكشف ٦ دقائق لكل مريض" on the live queue.
  6,
  -- "متاح ٢ مرة" on the defer-my-turn card.
  2,
  -- No cutoff on same-day booking; availability already excludes past windows.
  0,
  -- "التأجيل والإلغاء مجاني حتى ساعتين قبل الموعد".
  120,
  -- The prototype shows an approval queue and a "حجزك قيد المراجعة" state, so a
  -- parent's booking is a request until staff accept it.
  false
)
on conflict (slug) do nothing;

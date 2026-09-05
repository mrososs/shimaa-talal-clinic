-- The pilot clinic's working hours, from the prototype.
--
--   السبت – الأربعاء   ١٠:٠٠ – ٤:٠٠
--   الخميس             ١٢:٠٠ – ٥:٠٠
--   الجمعة             مغلق
--
-- The doctor is resolved by role, never by a hardcoded id: an `auth.users` uuid
-- is environment-specific and has no place in a migration that has to run
-- everywhere. If no doctor member exists yet — a fresh environment where
-- `pnpm bootstrap:staff` has not run — this inserts nothing rather than
-- failing, and `bootstrap:staff` performs the same idempotent insert once the
-- member exists.
--
-- Idempotent: `clinic_schedules_slot_uq` makes a re-run a no-op.
--
-- Window size and capacity are the prototype's booking screen ("متاح ٣ من ٥"),
-- not the doctor panel, which says four per half-hour. The two disagree and the
-- clinic has not settled it. Both are columns precisely so the answer is an
-- UPDATE rather than a release.

insert into clinic.clinic_schedules (
  clinic_id,
  doctor_member_id,
  weekday,
  session_kind,
  starts_at,
  ends_at,
  window_minutes,
  capacity_per_window,
  effective_from
)
select
  c.id,
  d.id,
  day.weekday,
  'morning',
  day.starts_at,
  day.ends_at,
  60,
  5,
  -- The clinic's own today, not the migration host's.
  (now() at time zone c.timezone)::date
from clinic.clinics c
-- The clinic's doctor. `limit 1` because the pilot has exactly one; a clinic
-- with two would need a row per doctor, which the unique index already allows.
cross join lateral (
  select m.id
    from clinic.clinic_members m
   where m.clinic_id = c.id
     and m.role = 'doctor'
     and m.status = 'active'
   order by m.created_at, m.id
   limit 1
) d
cross join (
  values
    -- Postgres' dow numbering: Sunday is 0, Saturday is 6.
    (6::smallint, time '10:00', time '16:00'),  -- السبت
    (0::smallint, time '10:00', time '16:00'),  -- الأحد
    (1::smallint, time '10:00', time '16:00'),  -- الاثنين
    (2::smallint, time '10:00', time '16:00'),  -- الثلاثاء
    (3::smallint, time '10:00', time '16:00'),  -- الأربعاء
    (4::smallint, time '12:00', time '17:00')   -- الخميس
    -- الجمعة: no row. A closed day is the absence of a schedule, not a
    -- schedule with a flag — availability then has nothing to generate.
) as day(weekday, starts_at, ends_at)
where c.slug = 'shimaa-talal'
-- Inferred from the unique index rather than named as a constraint: the index
-- is created by `create unique index`, so it has no constraint name to cite.
on conflict (clinic_id, doctor_member_id, weekday, session_kind, effective_from)
do nothing;

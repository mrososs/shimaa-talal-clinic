-- Infrastructure baseline.
--
-- The infrastructure baseline every later migration assumes. It enables the
-- extensions only; the clinic schema itself lands in the migration that
-- follows this one.
--
-- What this migration does is enable the extensions every future migration will
-- assume are present, so that the first real domain migration can start with
-- `gen_random_uuid()` without a surprise.
--
-- Workflow reminder: `supabase/migrations` is the source of truth for the
-- database. Create new migrations with `supabase migration new <name>` and
-- never edit a migration that has already been applied to a shared environment.

-- UUID generation (`gen_random_uuid()`), used for primary keys.
create extension if not exists "pgcrypto" with schema extensions;

-- Case-insensitive text, for values such as email addresses.
create extension if not exists "citext" with schema extensions;

-- Index the two foreign keys that 20260905120000_clinic_identity.sql left with
-- no leading index.
--
-- Postgres does not index a foreign key for you, and a composite index only
-- serves a lookup that includes its leading column. Both gaps below were found
-- by querying pg_constraint against pg_index after applying that migration.

-- guardians.auth_user_id is the second column of guardians_clinic_auth_user_uq,
-- so a lookup by auth_user_id alone cannot use it. That lookup is the hot path:
-- it runs on every authenticated parent request, and at sign-in the API has a
-- token but not yet a clinic — it learns the clinic *from* this row.
--
-- It also serves the ON DELETE SET NULL from auth.users, which would otherwise
-- sequentially scan every guardian in the database to unlink one account.
--
-- Partial, because unclaimed guardians are expected to be the majority and a
-- NULL is never the thing being looked up.
create index guardians_auth_user_idx
  on clinic.guardians (auth_user_id)
  where auth_user_id is not null;

-- Audit-only column, but it carries ON DELETE SET NULL from auth.users, and an
-- unindexed one turns deleting a user into a scan of this table.
create index guardian_claim_codes_consumed_by_idx
  on clinic.guardian_claim_codes (consumed_by_auth_user_id)
  where consumed_by_auth_user_id is not null;

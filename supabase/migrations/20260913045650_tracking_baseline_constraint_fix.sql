-- A clinic must be able to configure a baseline, observe it in shadow mode,
-- and validate it later. The foundation constraint accidentally collapsed
-- "configured" and "validated" into one state.

alter table clinic.clinics
  drop constraint clinics_baseline_validation_ck,
  add constraint clinics_baseline_validation_ck check (
    (configured_baseline_minutes is null
      and baseline_source is null
      and baseline_validated_at is null
      and baseline_validated_by is null)
    or
    (configured_baseline_minutes is not null
      and baseline_source = 'clinic_configured'
      and (
        (baseline_validated_at is null and baseline_validated_by is null)
        or
        (baseline_validated_at is not null and baseline_validated_by is not null)
      ))
  );

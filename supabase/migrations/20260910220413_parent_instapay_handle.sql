alter table clinic.clinics
  add column instapay_handle text,
  add constraint clinics_instapay_handle_check check (
    instapay_handle is null
    or char_length(btrim(instapay_handle)) between 3 and 200
  );

comment on column clinic.clinics.instapay_handle is
  'Clinic-owned InstaPay payment address shown to guardians before receipt upload.';

grant update(instapay_handle) on clinic.clinics to clinic_api;

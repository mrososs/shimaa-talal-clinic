# Mobile Data and Supabase Security

## Trust model

The Mobile and Dashboard browsers are untrusted clients. NestJS is the business
API authority. The `clinic` schema remains private to the trusted API posture;
frontends never query it directly.

## Identity

- Use Supabase publishable keys in Mobile only.
- Email/password is the current release path. When phone OTP is added in the
  next phase, do not put secrets or authorization claims in `user_metadata`.
- Resolve guardian membership server-side after authentication.
- Claiming an existing family requires the clinic-issued claim code; possessing
  an authenticated email account alone never authorizes the link.

## Tenant and child isolation

- Every query includes the resolved `clinicId`.
- Guardian reads require a guardian-child relationship in that clinic.
- Composite foreign keys must include `clinic_id` for appointments, sessions,
  children, guardians, payments, messages and urgent cases.
- Do not accept `clinicId`, `guardianId` or an arbitrary child owner from Mobile.
- Do not distinguish another family's resource from an invented ID in responses.

## Storage

- Patient files and payment receipts stay in private buckets.
- Uploads enforce MIME allowlists and size limits server-side.
- Downloads return short-lived signed URLs only after ownership/role checks.
- Never expose object paths as public URLs.

## Messaging and notifications

- A guardian may read and write only threads tied to their guardian/child pair.
- Notification payloads contain the minimum text needed for an in-app card and
  avoid diagnoses or sensitive clinical details.
- Notification creation is idempotent by aggregate/event key.
- `notification_outbox` is not a public read API; future delivery workers must
  use a trusted server boundary.

## Guest links

- Token payload is minimal, signed, short-lived and revocable.
- Store a hash or equivalent server-verifiable representation when persistence
  is required; never store raw bearer links for display.
- Apply rate limits and generic failures for invalid/expired tokens.
- Guest view exposes queue numbers and coarse status only.

## Database requirements

- Forward-only migrations under `supabase/migrations`.
- Forced RLS on every new table, with policies matching the actual access model.
- Explicit grants; no direct public access to the `clinic` schema.
- Transactions and row locks for queue, payment, urgent and appointment flows.
- Immutable event/audit rows for operational, financial and urgent transitions.

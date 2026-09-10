# Dashboard implementation context

This document is the execution reference for the clinic dashboard. It turns
`Clinic Dashboard - All Screens.html` into ordered implementation tasks with a
checkpoint after every usable slice. The HTML prototype is a visual and product
reference; it is not application code and must not be imported into Vue.

## Implementation progress

- [x] D0 — Design foundation and role-aware shell.
- [x] D1 — Real daily overview API and Vue screen.
- [x] D2 — Day/week/month appointment reads, search/status filters, live-capacity
      rescheduling, approval/rejection, and manual staff booking.
- [x] D3 — Explicit Queue commands, walk-in admission and the narrowed doctor
      board are complete and covered by component/domain tests.
- [x] D4 — Family directory, tenant-safe family record, children, visit history,
      claim-code UI and private patient attachments.
- [x] D5 — Doctor consultation drafts/finalisation, immutable clinical history,
      reception-safe measurement capture, growth tracking, previous visits,
      parent-summary preview and follow-up recommendation.
- [x] D6 — Live messages, per-member unread state, assignment, quick replies,
      close/reopen, urgent triage and atomic acceptance into Queue.
- [x] D7 — Provider-neutral payments, private InstaPay receipt decisions,
      role-projected reports and CSV export.
- [x] D8 — Doctor/admin clinic settings, effective-dated schedules, closures,
      prices, notification templates, team status/roles and immutable audit.
- [x] D9 — Final cross-role journey and release hardening.

## Product decisions already fixed

- The dashboard is Arabic and RTL and follows the prototype's warm, rounded,
  playful clinic identity.
- The production roles remain `doctor`, `reception`, and `admin`. The UI labels
  `reception` as **المساعدة**; no `assistant` role is added to contracts or the
  database.
- Authentication decides the visible role. The prototype role switcher is a
  preview device and must not exist in production.
- Appointment capacity is read from the materialised clinic session
  (`windowMinutes` and `capacityPerWindow`). No screen hard-codes 5/hour or
  4/half-hour.
- Business data always goes through NestJS. The browser uses Supabase for Auth;
  it does not query the `clinic` schema directly.
- Booking and Queue remain independent domains. Cross-domain appointment/queue
  synchronisation belongs to `@clinic/server-workflows`.
- Production screens use real API data. Demo fixtures belong to the local seed
  and demo tooling only.

## Screen and role matrix

| Screen                | Doctor               | Assistant (`reception`) | Admin                    | Delivery milestone |
| --------------------- | -------------------- | ----------------------- | ------------------------ | ------------------ |
| Overview              | Yes                  | Yes                     | Yes                      | D1                 |
| Appointments          | Yes                  | Yes                     | Yes                      | D2                 |
| Live queue            | Yes                  | Yes                     | Yes                      | D3                 |
| Patients and families | Yes                  | Yes                     | Yes                      | D4                 |
| Consultation          | Yes                  | No                      | Keep existing API policy | D5                 |
| Growth tracking       | Yes                  | No                      | Keep existing API policy | D5                 |
| Messages              | Yes                  | Yes                     | Yes                      | D6                 |
| Urgent cases          | Yes                  | Yes                     | Yes                      | D6                 |
| Payments              | Yes                  | Yes                     | Yes                      | D7                 |
| Reports               | Clinical + financial | Administrative          | Full                     | D7                 |
| Settings and team     | Yes                  | No                      | Yes                      | D8                 |

Reception must never see or mutate diagnoses, internal clinical notes, growth
decisions, or security settings. Hiding a route or button is not authorisation;
every NestJS endpoint enforces the same matrix.

## Visual contract

- Desktop reference viewport: 1280 x 820. The UI must also remain usable below
  1280 and adapt to a compact navigation layout at tablet widths.
- Display font: `Baloo Bhaijaan 2`; body font: `Tajawal`.
- Brand palette: warm cream background, coral primary action, teal success,
  sky/sun/lavender/rose accents, warm ink and borders.
- Layout: 256px reading-start sidebar, sticky top bar, one page scroll region,
  clear page hierarchy, and compact operational density.
- Reusable primitives: page heading, KPI item, status pill, segmented filter,
  table/list row, form field, confirmation/reason dialog, empty/loading/error
  state, and responsive two/three-column layouts.
- Use meaningful motion only for state changes and respect
  `prefers-reduced-motion`.
- All interactive controls need keyboard focus, an accessible name, disabled and
  busy states, and Arabic error copy.

## Architecture rules for every task

### Vue

- Vue 3 Composition API with `<script setup lang="ts">`.
- Route pages compose focused feature components; they do not contain several
  independent UI sections and request orchestration in one large SFC.
- Props flow down, typed events flow up, and API/polling state lives in a small
  feature composable.
- Each feature owns its API adapter under its feature folder. Runtime wiring is
  added only in the dashboard composition root.
- Derive filtered/sorted/permission state with `computed`; use watchers only for
  side effects and cancel stale requests where appropriate.

### NestJS and contracts

- Public request/response types live in `@clinic/contracts`; Nest-specific DTOs
  stay in the owning server library.
- Controllers validate, authorise, and delegate. Domain services own local
  state transitions. Cross-domain atomic commands live in workflows.
- Every staff read and mutation is scoped by `clinicId` resolved from the
  authenticated member, never from a trusted request body.
- Commands are explicit endpoints, not generic status patches.

### Supabase/Postgres

- Add forward-only migrations in `supabase/migrations`; never rewrite an applied
  migration.
- Every business table carries `clinic_id`, has tenant-consistent foreign keys,
  appropriate indexes, timestamps, constraints, and forced RLS following the
  existing trusted-API posture.
- Use database transactions and row locks for multi-row transitions and
  concurrency-sensitive counters.
- Clinical/financial mutations must produce immutable audit/event records.

## Ordered implementation tasks

### D0 — Design foundation and shell

Frontend:

- Extract the shared shell into focused sidebar and top-bar components.
- Add grouped role-aware navigation matching the prototype information
  architecture, but expose only routes whose slice is complete.
- Consolidate dashboard design tokens and shared primitives; remove page-level
  duplication as screens are migrated.
- Keep forbidden/unavailable identity states in the shell.

Checkpoint:

- Existing overview, appointments, booking, and queue routes render inside the
  new shell without functional regression.
- Doctor/reception/admin see only allowed links.
- Dashboard lint, typecheck, component tests, and production build pass.
- Visual check at 1280 x 820 and compact width has no horizontal page overflow.

### D1 — Real overview

Backend:

- Add `GET /api/v1/clinic/dashboard/summary` as a workflow read composed from
  Clinic, Booking, Queue, and Patients without introducing domain imports.
- Return today's appointment counts, waiting/in-service counts, completion and
  no-show counts, pending booking requests, urgent/unread placeholders only when
  those modules exist, and role-appropriate financial summary only after D7.

Frontend:

- Replace the current policy stub with greeting, role-specific KPIs, operational
  alerts, live queue snapshot, booking requests, and today's tasks.
- Link every card action to an implemented route and refresh after commands.

Checkpoint:

- Counts match direct database fixtures for doctor and reception accounts.
- Empty, partial, loading, and failed reads are all test-covered.

### D2 — Appointments and staff booking

Backend:

- Reuse the staff appointment read workflow and Booking commands for approve,
  reject, cancel, reschedule, and manual booking.
- Add date-range querying needed for day/week/month views without changing
  canonical appointment statuses.
- Keep `requested` as the stored/API value and present it as **بانتظار الموافقة**.
- Read capacity from the materialised session and reject closure overlaps inside
  `requireBookableWindow`.
- Validate guardian/child ownership, clinic scope, and tenant-consistent foreign
  keys for staff booking and walk-ins.

Frontend:

- Implement day/week/month switching, search, status filters, identity cells,
  approve/reject, reschedule, details, and manual booking.
- Display real session capacity and remaining seats.

Checkpoint:

- A parent request appears with child and guardian names and can be approved or
  rejected from the dashboard.
- Reschedule releases and acquires capacity atomically.
- A closure blocks new overlapping bookings without cancelling existing ones.

### D3 — Queue operations

Backend invariants:

- `Complete`: only `in_service -> done`, completes the linked appointment,
  records one event, bumps the session revision once, and never calls another
  patient.
- `Call Next`: never completes an active consultation. It returns HTTP 409 with
  `CurrentPatientStillInService` when an `in_service` entry exists.
- `Complete & Call Next`: completes the current patient and calls the next
  eligible waiting patient in one workflow transaction.
- An expired `called` entry becomes `missed`, and its appointment becomes
  `no_show`, before the next call. An unexpired grace period rejects the compound
  workflow and rolls back completion.
- `paused` freezes every queue mutation without event or revision change.
- Server-owned ordering remains `(priority, sort_key)` under the clinic-session
  row lock.

Frontend:

- While a patient is in service show **إنهاء الكشف** and
  **إنهاء واستدعاء التالي**. Do not label the second action as only
  **استدعاء التالي**.
- Show the normal **استدعاء التالي** action only when no patient is in service.
- Do not reproduce the prototype's generic per-row status selector.
- Add the walk-in family search/dialog and the narrowed doctor board.

Checkpoint:

- Complete-only, compound completion, last-patient, expired/unexpired grace,
  paused state, and simultaneous-command tests all pass with correct events and
  revision values.

### D4 — Patients and families

Backend:

- Extend Patients staff reads for family search/detail, linked children, visit
  history, and claim-code issuance.
- Add attachment metadata/storage workflows with clinic and child access checks.
- Do not expose clinical notes through operational family responses.

Frontend:

- Implement family/child list, patient detail tabs, family account, add child,
  visit history, files, claim code, start-visit and message entry points.
- Show growth only as a safe summary for reception; doctor-only details belong
  to D5.

Checkpoint:

- Cross-clinic identifiers return not-found/forbidden without leaking identity.
- Upload, download and claim-code flows pass API and browser tests.

### D5 — Consultation and growth (doctor only)

Backend:

- Add a clinical domain for encounters, draft/final notes, measurements,
  follow-ups, parent summaries, and growth observations.
- Add tenant-safe schema, immutable audit history, and doctor-only mutation
  guards. Completing the clinical encounter must use a workflow when it also
  completes a Queue/Booking state.

Frontend:

- Implement consultation draft/finalise, reception-recorded measurements,
  previous visits, follow-up scheduling, parent-summary preview, growth history,
  charts, and new measurement entry.

Checkpoint:

- Drafts remain editable; final records are versioned rather than overwritten.
- Reception receives 403 for every clinical read/mutation excluded by policy.
- Finishing an encounter cannot leave Queue and Booking inconsistent.

### D6 — Messages and urgent triage

Backend:

- Add message threads/messages, unread state, assignment/escalation, quick reply
  templates, thread close/reopen, notification outbox, and urgent-case events.
- Keep urgent triage separate from Queue; accepting a case into the live queue is
  a cross-domain workflow.

Frontend:

- Implement message filters, thread list, conversation, quick replies, drafts,
  close/reopen, and **تحويل للطبيبة**.
- Implement assistant triage and doctor decision screens with explicit emergency
  guidance states.

Checkpoint:

- Unread counters, assignment, concurrent replies, close/reopen and urgent
  escalation are covered by API and E2E tests.

### D7 — Payments and reports

Backend:

- Implement provider-neutral payments, cash registration, InstaPay receipt
  verification, rejection, refund, and idempotency.
- Add indexed server-side aggregates for weekly activity, completion/no-show,
  waiting time, service revenue, appointment distribution, peak hours, and
  online/clinic source.

Frontend:

- Implement payment KPIs, filters and verification actions.
- Implement role-specific report KPIs/charts and export; doctor sees clinical and
  financial detail while reception sees administrative reporting.

Checkpoint:

- A receipt cannot be approved/refunded twice.
- Report totals reconcile with booking, queue and payment fixtures.

### D8 — Settings, team and audit

Backend:

- Add APIs for clinic details, schedules, closures, prices/policies,
  notification templates, team membership/status, and audit reads.
- Schedule changes are effective-dated and do not rewrite materialised sessions
  or existing appointments.

Frontend:

- Implement clinic, policies/prices, notifications, staff/permissions and audit
  tabs for doctor/admin.

Checkpoint:

- Every setting mutation is audited.
- Reception cannot reach settings routes or endpoints.
- Schedule/capacity changes affect only newly materialised sessions.

### D9 — Release hardening

- Add one browser journey covering parent request -> staff approval -> check-in
  -> queue -> consultation completion -> payment/report visibility.
- Run migration dry-run, constraint/RLS tests, lint, typecheck, unit/integration
  tests, production builds, Chrome E2E, accessibility and visual regression.
- Keep database-backed test targets non-parallel and the default test pool at
  five connections.
- Update `status.md`, architecture and project-structure docs after each shipped
  slice; do not mark a screen built until its real API and permission tests pass.

Checkpoint — completed 2026-09-10:

- `dashboard-e2e` provisions isolated temporary Supabase users/data and cleans
  them after the run.
- The Chrome journey proves the parent, reception and doctor hand-off through
  completion, payment and role-safe reports.
- WCAG 2 A/AA and a fixed-sidebar visual snapshot run in the same journey.
- Migration dry-run reports the hosted database up to date; lint, typecheck,
  unit/integration tests and production builds pass across the workspace.

## Definition of done for every dashboard slice

- Real NestJS contract and Supabase-backed persistence/read model are complete.
- API role and tenant checks are tested; UI hiding is not counted as security.
- Vue has loading, empty, success, validation and failure states.
- The page matches the prototype's visual system and passes RTL/responsive and
  keyboard checks.
- Mutations refresh or reconcile the authoritative server state.
- Unit, integration and browser tests pass, and the checkpoint is recorded in
  `docs/status.md`.

## Known prototype differences that must remain intentional

- Prototype `Call Next` implicitly completes the current patient; production
  uses the three explicit queue commands described in D3.
- Prototype appointment status `pending` maps to canonical `requested`.
- Prototype capacity labels are replaced by live session configuration.
- Prototype role switching is omitted from production.
- A parent's exact ticking wait countdown and a list of other patients remain
  excluded; the server exposes a coarse wait range and privacy-safe position.
- Queue status changes remain explicit commands, never a generic status select.

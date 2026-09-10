# Mobile App Implementation Context

## Purpose

This document is the execution reference for the parent/guardian mobile app.
The attached `Clinic Mobile App - All Screens.html` is a visual and product
prototype only; it must not be imported into production code.

The production stack is Ionic Vue + Capacitor in `apps/mobile`, Vue in
`apps/dashboard`, NestJS in `apps/api`/`libs/server`, shared framework-free
contracts in `libs/contracts`, and Supabase/Postgres for persistence.

## Product decisions

- All 26 prototype screens are in scope, delivered through P0/P1/P2 slices.
- Arabic RTL UI follows the prototype's warm cream, coral, teal and rounded-card
  design system using `Baloo Bhaijaan 2` and `Tajawal`.
- Mobile polling is 15 seconds; Dashboard polling is 5 seconds. Both use a
  sequence guard, preserve the last successful view during refresh, pause while
  hidden, and refresh immediately after a user action.
- Email/password is the first-release authentication path. Phone login and OTP
  move together to the next phase, after the hosted SMS provider is configured.
  In-app notifications are first; native push and SMS/WhatsApp delivery remain
  later work.
- Parent payment uses cash-at-clinic or InstaPay receipt upload with explicit
  staff approval. No direct bank gateway is part of the first release.
- Guest queue links are signed, read-only, expire at the end of the session day,
  and are copied/shared from Dashboard. They expose no personally identifiable
  or clinical data.
- The assistant is a doctor-curated FAQ in the first release, not an LLM.
- Booking and Queue remain independent. Cross-domain changes belong in
  `server-workflows` and run in one database transaction.

## Prototype screen inventory

| Group           | Screens                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| Auth/onboarding | Sign in, sign up, reset password, guardian + child profile; phone login/OTP next phase   |
| Main            | Home, live queue, booking, payment, messages, growth                                     |
| Additional      | FAQ assistant, urgent case, appointment management                                       |
| State variants  | Doctor late, turn now, booking pending, grace countdown, grace expired, paid/cash missed |
| Guest           | WhatsApp waiting, reception waiting, guest turn now                                      |

## Task checklist

- [x] M0 — Mobile shell and design system.
- [x] M1 — Email auth and family onboarding (phone login/OTP deferred).
- [x] M2 — Booking, appointment status and Dashboard approval.
- [ ] M3 — Queue read model, explicit staff commands and guest links.
- [x] M4 — Parent payments and receipt review.
- [x] M5 — Parent messages and urgent triage.
- [x] M6 — Parent-safe growth reads.
- [ ] M7 — Grace, missed, reschedule and cancellation.
- [ ] M8 — In-app notifications and deep links.
- [ ] M9 — Cross-role hardening and release verification.

## Architecture rules

- Vue pages are composition surfaces; feature state and polling live in focused
  composables. Use Composition API and `<script setup lang="ts">`.
- Props flow down and typed events flow up. Do not mutate props or place API
  calls in presentational components.
- Controllers validate and authorize; domain services own local transitions;
  workflows own cross-domain orchestration.
- Parent endpoints derive `guardianId` and `clinicId` from the authenticated
  context. Never trust either value from a request body.
- Supabase keys in browsers are publishable only. Business tables are reached
  through NestJS, not directly from Mobile or Dashboard.
- Every mutation has an idempotency strategy where retries are possible, and
  every state transition writes its event in the same transaction.

## Checkpoints

Each task is complete only when its checkpoint passes, its tests are green,
the relevant docs are updated, and `docs/status.md` reflects the actual state.

### M0 checkpoint

412×892 Mobile viewport has no horizontal overflow, correct RTL/safe-area
behavior, accessible loading/error/empty states, and working navigation.

Implemented with a router-level `IonTabs` shell at `/tabs/*`. Home,
appointments and queue keep independent Ionic navigation stacks; auth,
onboarding, booking and detail routes remain outside the shell. The Chrome
journey verifies the exact viewport, RTL, overflow, 44px tab targets, tab
navigation and that focused task routes hide the tab bar.

### M1 checkpoint

New and existing guardians can authenticate with email/password, recover their
password, complete family setup, or claim an existing family without
cross-tenant data leakage. Phone login and OTP are not part of this checkpoint.

Implemented with guarded onboarding routes, server-owned guardian/child scope,
claim-code throttling and password recovery. Phone routes are intentionally not
registered in the release router.

### M2 checkpoint

Parent booking appears in Dashboard with guardian/child names, can be approved,
and changes back to Mobile as requested/confirmed without capacity races.

The appointment list, detail and Home summary poll at the Mobile cadence without
blanking their last successful state. Parent cancellation and rescheduling use
the existing Booking commands; a capacity conflict reloads availability before
another selection.

### M3 checkpoint

Dashboard check-in/call/start/complete actions update Mobile's private queue
view. `Complete`, `Call Next`, and `Complete & Call Next` remain explicit and
atomic. Guest links work without login and reveal only queue facts.

### M4 checkpoint

Cash and InstaPay receipt flows are idempotent, private, staff-reviewable, and
their status is visible to the owning guardian only.

Implemented with guardian-only `GET /payments`, `POST /payments/cash` and
multipart `POST /payments/instapay`. The API derives the appointment identity,
child, guardian, amount and currency; Mobile submits only the appointment,
idempotency key and (for InstaPay) a validated receipt. Cash stays pending until
staff confirm it, receipts stay in the private bucket, and fifteen-second
polling brings staff decisions back to the owning guardian.
The InstaPay destination is nullable clinic configuration maintained in
Dashboard settings and returned by the parent view. When absent, Mobile disables
InstaPay and keeps cash available; it never embeds a financial address in the
bundle.

The booking and live-queue screens now follow the supplied prototype's visual
hierarchy: service and child cards, horizontal day/window selectors, a sticky
continue-to-payment action, live concentric queue counter, ETA card and the
dedicated pending-approval state. The implementation deliberately keeps honest
arrival windows and the guardian-safe `aheadCount`; it does not invent 12-minute
slots or reveal other patients' ticket numbers from the static prototype.

### M5 checkpoint

Parent messages reach the staff inbox, replies reach Mobile, closed threads
reject replies, and urgent acceptance creates a queue entry atomically.

Implemented with six guardian-only routes under `/messages`, a fifteen-second
Mobile inbox poll, per-guardian unread state and idempotency keys for both new
threads and replies. The guardian sees explicit emergency guidance before
raising an urgent case; the existing doctor/admin workflow remains the only
command that accepts it into Queue.

### M6 checkpoint

Doctor-recorded measurements appear to the owning guardian while diagnoses,
drafts and internal notes remain inaccessible.

`GET /children/:childId/growth` verifies the guardian-child relationship before
reading. Its dedicated contract omits appointment IDs, temperature, encounter
content and every staff-only field. Mobile renders child switching, an
accessible weight/height graph and measurement history.

### M7 checkpoint

Grace expiry, missed/no-show, reschedule and cancellation honor clinic policy,
payment state and transaction rollback rules.

### M8 checkpoint

Notifications are deduplicated, scoped to the correct guardian, and deep-link
to the correct appointment, queue, message or payment screen.

### M9 checkpoint

The complete parent → reception → doctor journey passes in Chrome at Mobile
4202, Dashboard 4203 and API 3000, plus production build and Capacitor web
smoke checks.

# Status

Where Phase 2 actually stands. The other documents in `docs/` explain _why_ the
system is shaped the way it is and do not change often; this one records what
exists, and is expected to be edited every time a slice lands.

Anything not listed as built is not built. If a claim here disagrees with the
code, the code is right and this file is stale — say so.

_Last updated: 2026-09-11 · 18 migrations · 106 routes._

---

## 1. Built

### Database

Eighteen migrations are in source control and applied to the hosted pilot database.
Every table lives in the `clinic` schema, which
is absent from `[api].schemas` in `supabase/config.toml` — so the publishable
key shipped in both bundles cannot reach any of it. RLS is `ENABLE` + `FORCE`
on every table; policies grant the dedicated `clinic_api` role only, never the
public browser roles. This is a second lock under the trusted API. See
[database.md](database.md).

| Migration                           | Tables                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `init_extensions`                   | —                                                                                                                       |
| `clinic_identity` (+ `_fk_indexes`) | `clinics`, `clinic_members`, `guardians`, `children`, `guardian_children`, `guardian_claim_codes`                       |
| `pilot_clinic`                      | the pilot tenant row                                                                                                    |
| `clinic_scheduling`                 | `clinic_schedules`, `clinic_closures`, `clinic_sessions`                                                                |
| `pilot_schedule`                    | Sat–Wed 10:00–16:00, Thu 12:00–17:00, Friday absent                                                                     |
| `booking`                           | `appointments`, `appointment_events`                                                                                    |
| `queue`                             | `queue_entries`, `queue_events`                                                                                         |
| `booking_queue_tenant_consistency`  | composite tenant foreign keys for Booking and Queue                                                                     |
| `patient_files`                     | private attachment metadata and the private `clinic-patient-files` Storage bucket                                       |
| `clinical_records`                  | `clinical_encounters`, immutable `clinical_encounter_versions`, and reception-safe `clinical_measurements`              |
| `messages_urgent_triage`            | staff inbox, read markers, quick replies, urgent cases, immutable events, and notification outbox                       |
| `parent_messages`                   | guardian actors, parent unread cursor and idempotent parent thread creation                                             |
| `parent_payments`                   | guardian actors, one active payment per appointment and parent payment audit events                                     |
| `payments_and_reports`              | provider-neutral payments, immutable payment events, reporting indexes, and the private receipt bucket                  |
| `clinic_settings_audit`             | service prices, notification templates, immutable setting audit events, clinic contact details and InstaPay destination |
| `parent_instapay_handle`            | nullable clinic-owned InstaPay destination with database validation                                                     |
| `queue_guest_links`                 | revocable, end-of-day guest queue capabilities storing only SHA-256 token digests                                       |

### The four concurrency guarantees

Each is a partial unique index, and each is proven by a test that actually
races rather than by reading the schema:

| Guarantee                                      | Index                                            | Proof                                                         |
| ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| A window's capacity cannot be exceeded         | `appointments_seat_uq`                           | 10 parallel bookings at capacity 5 → exactly 5                |
| A session's tickets are unique and consecutive | `queue_ticket_uq`                                | 10 parallel check-ins → 10 distinct numbers                   |
| One patient called, one in service             | `queue_one_called_uq`, `queue_one_in_service_uq` | concurrent queue commands leave one called and one in service |
| One check-in per appointment                   | `queue_appointment_uq`                           | 5 simultaneous check-ins → one entry, five 201s               |

### API — 106 routes

Auth (guard, `@Roles`, cached verifier, envelope interceptor) · identity
(parent + staff, claim codes) · clinic sessions (list, open/pause/resume/close,
doctor presence, pace) · booking (availability, create, approve, reject,
cancel, reschedule, no-show) · queue (board, walk-in, call, start, miss,
requeue, cancel, emergency, move) · workflows (check-in, complete-only,
call-next, complete-and-call-next, cancel, the staff board, the parent view,
the dashboard's real daily summary, and the cross-domain operational family
record with note-free visit history).
Guardians have a separately authorized growth endpoint that verifies child
ownership and returns only weight, height, head circumference and measurement
time; temperature, appointment linkage and clinical notes never cross that
contract.
Doctor/admin-only patient-file routes list and upload private PDF/image
attachments and mint one-minute signed download URLs. Reception is rejected by
the API rather than only hidden in Vue.
The clinical workflow adds doctor/admin encounter reads, editable drafts and an
atomic finalisation that completes Queue and Booking in the same transaction.
All active staff may capture measurements, while Reception cannot read clinical
notes, growth history or private attachments.
Messages adds a tenant-safe staff inbox with per-member unread state, idempotent
replies, assignment, close/reopen, quick replies and urgent triage. Only
doctor/admin may decide an urgent case; accepting it into the live Queue is one
cross-domain transaction and a concurrent second decision is rejected.
Guardians have a separate six-route message surface scoped entirely from their
authenticated context. It derives names server-side, counts only staff replies
as unread, refuses foreign thread IDs as not found, and records the guardian as
the actual actor rather than fabricating a clinic member.
Payments adds idempotent cash registration, private InstaPay receipt upload and
explicit approval/rejection/refund transitions. Reports compose indexed
Booking, Queue and Payments aggregates; Reception receives administrative
metrics with the financial projection removed by the API.
Doctor/admin settings cover clinic details, policies, prices, notification
templates, effective-dated schedules, closures, team status/roles and audit
reads. Reception is rejected by the API. Every setting mutation writes its
audit event in the same transaction.

`Complete`, `Call Next`, and `Complete & Call Next` are separate API commands.
`Call Next` never ends an active consultation; paused sessions reject every
queue mutation without an event or revision bump.

Guardians have a separate three-route payment surface. Its view combines owned
payments with server-priced payable appointments; cash choices and receipt
uploads derive every identity and amount field from the appointment and record
the guardian as the real audit actor.

Queue also exposes Reception/Admin-only creation and revocation of an opaque
guest tracking link plus one anonymous read. A link is limited to one active
capability per entry, stores no raw token, expires at the clinic-local end of
day and returns ticket/session facts without names, phone numbers or clinical
data.

### Mobile — 17 screens

Sign in/up · password reset/update · guardian and child onboarding · claim an
existing family · home · appointments list/detail/reschedule · book a visit ·
live queue · payments · parent-safe growth · clinic messages and urgent guidance.

The mobile foundation now uses a real router-level Ionic tabs shell for Home,
Appointments, Queue and Messages. Focused auth, onboarding, booking and detail flows stay
outside it. RTL, safe-area spacing, minimum touch targets and the exact 412×892
layout are covered by the Chrome journey with no horizontal overflow.

The live queue renders: booked-but-not-arrived · waiting (the counter) ·
near-turn · called with the grace countdown · in service · missed · removed ·
done · session paused · doctor absent or delayed · nothing today · loading ·
failure with retry. Self-defer is offered while waiting and within the clinic's
limit.

Appointment list, detail and the Home summary now poll every fifteen seconds,
so a Reception approval or rejection appears without manual refresh. Parent
rescheduling selects a new server-owned availability window and refreshes
capacity after a race. Growth supports child switching, weight/height curves
and a dated measurement history through the guardian-only endpoint.
Messages is the fourth Ionic tab. It supports owned-child conversations,
idempotent replies, closed-thread handling, parent unread state and explicit
urgent escalation after emergency-care guidance; staff replies appear on the
same fifteen-second live-update lifecycle.
Payments is a focused route reached from Home, appointment detail, and the
booking completion flow. It offers cash-at-clinic and private InstaPay receipt
upload, keeps uncertain retries idempotent, and renders pending/paid/failed/
refunded history. The transfer destination is clinic-owned configuration edited
in Dashboard and read from the API; Mobile never hard-codes financial details.
Booking and Queue now match the supplied warm RTL prototype's
card hierarchy, horizontal selectors, sticky action, live ring, ETA and pending
approval treatment while keeping server-owned arrival windows and private
`aheadCount` semantics.
The public guest queue screen runs outside authentication and Ionic tabs, uses
the same responsive visual language, polls every fifteen seconds and never
renders patient identity.

### Dashboard — 12 screens

Sign in · appointments day view with child and guardian identity · reception
booking · queue board · real overview with appointment KPIs, a live queue
snapshot and pending booking requests. The shared shell has grouped,
role-aware navigation and focused sidebar/top-bar components. Appointments now
support day/week/month ranges, search, status filters and live-capacity
rescheduling. The Queue includes walk-in family selection and a narrowed doctor
presentation. Patients and families adds scoped search, linked children,
upcoming/past visits, one-time claim-code issuance, child selection and private
patient attachments for doctor/admin.
Doctor/admin additionally have consultation and growth screens. Consultation
shows reception measurements, versioned drafts, previous visits, a parent-summary
preview and a follow-up date; Reception captures vitals from Queue without being
given clinical-record read access.
Messages and urgent triage are live for Doctor and Reception with five-second
polling, non-destructive background refresh, quick replies, explicit emergency
guidance and role-specific triage/decision actions.
Payments shows collection KPIs, cash registration, receipt review and guarded
refund actions. Reports supports bounded date ranges, operational aggregates,
role-specific financial visibility and CSV export. The desktop sidebar remains
fixed and non-scrollable with all twelve screens linked.
Settings adds five doctor/admin tabs for clinic policy, schedules/closures,
notification templates, team permissions and the audit trail.

Release hardening adds an isolated Chrome journey that provisions temporary
Supabase Auth users and clinic data, then proves the complete parent request →
approval → check-in → queue → consultation → cash payment → role-safe report
flow. It cleans every marked row and Auth user after success or failure. The
same journey runs WCAG 2 A/AA checks and a visual regression snapshot for the
fixed doctor sidebar. Mobile and Dashboard development URLs are fixed at
`4202` and `4203` respectively.

### Live updating

One polling lifecycle in `@clinic/client-ui`, used by both apps: dashboard 5 s,
mobile 15 s, one loop per view, paused while the screen is hidden, immediate
full read on return, immediate refresh after the user's own action, and a
sequence guard so a slow response cannot overwrite a newer one.

Verified with three clients open at once — reception, doctor, parent — where
the parent's phone moved waiting → next → your turn → completed driven entirely
by changes made elsewhere, with nobody pressing refresh.

---

## 2. Not built

|                                  | Why it matters                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| **H3 — local JWT verification**  | Still one Supabase round trip per uncached token. The `TokenVerifier` seam exists for the swap. |
| **CI**                           | `pnpm lint && pnpm test` is run by hand                                                         |
| **Outbound notification worker** | `notification_outbox` is durable, but no scheduler/provider drains it yet.                      |

Deliberately out of Phase 2 entirely: phone login/OTP, SMS/WhatsApp delivery, push,
prescriptions, AI assistant, insurance, lab, pharmacy, and offline-first.

---

## 3. Known defects and open questions

**A staff account with memberships at two clinics resolves to an arbitrary
one.** `ClinicMemberService.findByAuthUserId` orders by `(active first, id)` and
takes the first. Harmless while the pilot runs one clinic; wrong for a schema
that carries `clinic_id` everywhere by design. The fix is a product decision —
probably scoping the lookup to `CLINIC_SLUG`.

**Deferring with nobody behind you costs a deferral and moves nothing.** The
server falls back to a tail sort key, so the entry keeps its position while
`defer_count` increases. Fixing it needs either a new field on the parent view
or a server-side refusal.

**`GET /queue/me` and `GET /clinic/queue` are the only reads composed above the
domains.** They live in `@clinic/server-workflows` because each joins Queue with
Booking, Patients and Clinic, and none of those four may see the others. The
plan's §24 lists Queue as the owner of the board; that cannot compile under the
boundary rules. Recorded here so the next reader does not "fix" it back.

### Open product decisions

- **Window size and capacity.** Seeded at 60 minutes × 5. The prototype
  disagrees with itself: `book.jsx` shows 5 per hour, the doctor panel shows 4
  per half-hour.

---

## 4. Design reference

`UI/` holds the exported prototype and is git-ignored — roughly 33 MB of HTML
with base64 fonts in every file. Read it when building a screen; nothing
imports it.

Three things in it are deliberately **not** implemented, and should not be
added without reopening the decision:

- The parent's ticking `mm:ss` countdown to their turn. Replaced by "أمامك N
  حالات" and a coarse range. A ticking clock is a promise the clinic cannot
  keep and a parent reads it as one.
- The parent's "ترتيب الطابور" list, which shows every other patient's ticket
  number. `ParentQueueItem` has nowhere to put one.
- The queue board's per-row status `<select>`. Replaced by explicit commands,
  because a dropdown offers transitions the server refuses.

# Status

Where Phase 2 actually stands. The other documents in `docs/` explain _why_ the
system is shaped the way it is and do not change often; this one records what
exists, and is expected to be edited every time a slice lands.

Anything not listed as built is not built. If a claim here disagrees with the
code, the code is right and this file is stale — say so.

_Last updated: 2026-09-06 · 36 commits · 8 migrations · 53 routes._

---

## 1. Built

### Database

Eight migrations, all applied. Every table lives in the `clinic` schema, which
is absent from `[api].schemas` in `supabase/config.toml` — so the publishable
key shipped in both bundles cannot reach any of it. RLS is `ENABLE` + `FORCE`
on every table with no permissive policies, as a second lock under a trusted
API. See [database.md](database.md).

| Migration                           | Tables                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `init_extensions`                   | —                                                                                                 |
| `clinic_identity` (+ `_fk_indexes`) | `clinics`, `clinic_members`, `guardians`, `children`, `guardian_children`, `guardian_claim_codes` |
| `pilot_clinic`                      | the pilot tenant row                                                                              |
| `clinic_scheduling`                 | `clinic_schedules`, `clinic_closures`, `clinic_sessions`                                          |
| `pilot_schedule`                    | Sat–Wed 10:00–16:00, Thu 12:00–17:00, Friday absent                                               |
| `booking`                           | `appointments`, `appointment_events`                                                              |
| `queue`                             | `queue_entries`, `queue_events`                                                                   |

### The four concurrency guarantees

Each is a partial unique index, and each is proven by a test that actually
races rather than by reading the schema:

| Guarantee                                      | Index                                            | Proof                                           |
| ---------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| A window's capacity cannot be exceeded         | `appointments_seat_uq`                           | 10 parallel bookings at capacity 5 → exactly 5  |
| A session's tickets are unique and consecutive | `queue_ticket_uq`                                | 10 parallel check-ins → 10 distinct numbers     |
| One patient called, one in service             | `queue_one_called_uq`, `queue_one_in_service_uq` | two simultaneous _Call Next_ → one 200, one 409 |
| One check-in per appointment                   | `queue_appointment_uq`                           | 5 simultaneous check-ins → one entry, five 201s |

### API — 53 routes

Auth (guard, `@Roles`, cached verifier, envelope interceptor) · identity
(parent + staff, claim codes) · clinic sessions (list, open/pause/resume/close,
doctor presence, pace) · booking (availability, create, approve, reject,
cancel, reschedule, no-show) · queue (board, walk-in, call-next, call, start,
miss, requeue, cancel, emergency, move) · workflows (check-in, complete,
cancel, the staff board, the parent view).

### Mobile — 10 screens

Sign in/up · guardian and child onboarding · claim an existing family · home ·
appointments list and detail · book a visit · live queue.

The live queue renders: booked-but-not-arrived · waiting (the counter) ·
near-turn · called with the grace countdown · in service · missed · removed ·
done · session paused · doctor absent or delayed · nothing today · loading ·
failure with retry. Self-defer is offered while waiting and within the clinic's
limit.

### Dashboard — 5 screens

Sign in · appointments day view · reception booking · queue board · overview
(a stub, see below).

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

|                                                 | Why it matters                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Doctor view (D9)**                            | The doctor sees the board with reception-only controls hidden, but the approved narrowing — current patient, next few, start/complete only — is unbuilt. **`UI/doctor` shows the doctor with the _full_ reception board, which contradicts the plan. Needs a product decision before building.** |
| **Walk-in dialog**                              | `POST /clinic/queue/walk-in` works; the board has no button, because it needs the family search from the booking screen                                                                                                                                                                          |
| **Reschedule UI**                               | Both endpoints exist; neither app has a screen                                                                                                                                                                                                                                                   |
| **`AppointmentListItem` on the staff day list** | `GET /clinic/appointments` returns `Appointment[]`, so the dashboard's appointments screen shows times and visit types but **no patient names**. The queue board has names; that screen does not.                                                                                                |
| **Dashboard overview**                          | A stub showing clinic policy, not the day's counts                                                                                                                                                                                                                                               |
| **Guardians screen / claim-code UI**            | Search and create live inside the booking flow; reception cannot issue a claim code, so a parent cannot link to an existing family                                                                                                                                                               |
| **H3 — local JWT verification**                 | Still one Supabase round trip per uncached token. The `TokenVerifier` seam exists for the swap.                                                                                                                                                                                                  |
| **H4 — journey test**                           | The loop is proven in pieces and by hand in a browser, not by one end-to-end test                                                                                                                                                                                                                |
| **CI**                                          | `pnpm lint && pnpm test` is run by hand                                                                                                                                                                                                                                                          |

Deliberately out of Phase 2 entirely: phone OTP, SMS/WhatsApp, payments, push,
medical records, prescriptions, growth tracking, AI assistant, chat, reports,
analytics, insurance, lab, pharmacy, offline-first.

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

- **`UI/doctor` vs the approved doctor view** — see above.
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

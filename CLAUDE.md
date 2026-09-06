# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A clinic operating platform for one paediatric clinic in Cairo: an Ionic Vue
app for parents, a Vue dashboard for staff, and a NestJS API over PostgreSQL.
Arabic, right-to-left, throughout.

**Read [docs/status.md](docs/status.md) first.** It records what is actually
built, what is not, and the open product decisions. The rest of `docs/` explains
_why_ the system is shaped as it is and changes rarely.

---

## Commands

```bash
pnpm dev:api          # NestJS, http://localhost:3000/api/v1  (webpack watch)
pnpm dev:dashboard    # staff dashboard, :4201
pnpm dev:mobile       # parent app, :4200
pnpm dev              # all three

pnpm lint             # 19 projects
pnpm test             # 19 projects — server suites hit a real database
pnpm typecheck
pnpm build

pnpm graph            # the dependency graph, which is the architecture
pnpm bootstrap:staff  # link existing Supabase Auth users to the clinic as staff
pnpm demo:day         # seed a throwaway half-day so screens have something on them
pnpm demo:day:down    # and remove it
```

### Running one test

Server-side is Jest, client-side is Vitest, and their filters differ:

```bash
# Jest (apps/api, libs/server/*) — note the PLURAL flag; Jest 30 renamed it
# and the singular form fails with a confusing error.
pnpm nx test api --testPathPatterns=queue.spec
pnpm nx test api --testPathPatterns=queue.spec --testNamePattern="grace"

# Vitest (apps/mobile, apps/dashboard, libs/client/*, contracts, phone)
pnpm nx test mobile -- useLiveQueue        # filter by filename
pnpm nx test client-ui -- -t "refuses an older answer"
```

### Testing against the database

**Server tests run against the real hosted PostgreSQL**, not a mock and not a
local container. They need a populated `.env`, they create and delete their own
fixtures, and they share one database with every other suite — so a test that
leaves rows behind breaks a _different_ suite later. Clean up in `afterAll`,
never inline after the assertions, because inline cleanup does not run when an
assertion fails.

Two things that will otherwise cost an hour:

- The six database-backed projects carry `"parallelism": false` on their `test`
  target. Supabase's session pooler allows 15 clients; `DATABASE_POOL_MAX` is
  10, so two suites racing ten parallel transactions each exhaust it. **Stop
  `pnpm dev:api` before a full test run** for the same reason.
- Never give one auth account memberships at two clinics in a fixture.
  `findByAuthUserId` picks between them by uuid order, so every request that
  account makes lands at whichever clinic sorted first — a coin toss per run.

### Migrations

`DATABASE_URL` connects as `clinic_api`, a least-privilege role with no
`CREATE`, so the application deliberately cannot alter its own schema. Schema
changes go through the Supabase MCP `apply_migration`, which assigns the
version — then rename the local file in `supabase/migrations/` to match.
`MIGRATION_DATABASE_URL` is the owner connection, used only by tooling.

Dry-run every migration in a rolled-back transaction that _exercises_ it —
insert rows and violate the constraint you just added — rather than only
checking that the DDL parses.

---

## Architecture

### Three intersecting boundary axes

`eslint.config.mjs` enforces `type:`, `platform:` and `scope:` tags, and they
intersect — a project must satisfy all three. This is the single most
load-bearing thing to understand before adding a file.

```
type:      app → workflow → feature → data-access → util → contract
platform:  mobile | dashboard | client | server | shared
scope:     booking | queue | payments | patients | notifications
           | shared | orchestration
```

Domains are islands: `scope:booking` may depend on `scope:booking` and
`scope:shared`, never on `scope:queue`. See
[docs/dependency-rules.md](docs/dependency-rules.md). If a rule blocks you, the
answer is almost never an `eslint-disable` — it is one of the two patterns
below.

### Crossing a domain boundary

**Writes, and reads that compose several domains, go in
`libs/server/workflows`** (`type:workflow`, `scope:orchestration`) — the one
project allowed to depend on several domains at once. It opens a single
`database.transaction()` and passes the executor down; it never holds domain
rules. Currently: check-in, complete, cancel, the staff queue board, and the
parent queue view. The last two are _reads_ that live there because each joins
Queue with Booking, Patients and Clinic.

**Identity questions use a port.** `server-core` declares an interface and a
Symbol, the owning domain implements it, and `apps/api` binds them —
`TOKEN_VERIFIER`, `GUARDIAN_RESOLVER`, `CLINIC_MEMBER_RESOLVER`,
`CHILD_ACCESS_CHECKER`. Note that Nest resolves a controller's dependencies from
its own module and its imports, so a port published only as an `AppModule`
provider is invisible inside a domain module — `DomainPortsModule` is `@Global`
for exactly that reason.

`libs/server/clinic` is tagged `scope:shared` deliberately: Booking reads a
session's capacity, Queue writes its operational state, and neither may see the
other.

### The server owns the queue

Ordering is `(priority, sort_key)` and it never leaves the server —
`QueueEntryService.COLUMNS` omits both columns on purpose. A client that could
read them would sort with them, and then the order would live in two places.

- `ticketNumber` is a human label, immutable, and **never a position**.
  `myTicket - nowServing` is wrong the moment anyone is reordered or an
  emergency is admitted. Use the server's `aheadCount`.
- An emergency is `priority = 10`, not a status. One row changes; nobody is
  renumbered.
- Grace is `grace_expires_at`, metadata on a `called` entry, not a status.
  Nothing expires on a timer — there is no scheduler anywhere in this system.
  Staff act, and the API validates against the deadline.
- Every mutation bumps `clinic_sessions.revision` in the same statement as the
  change it describes. That number is what every poller compares against, so a
  session write that forgets it goes invisible to every open screen.

### Concurrency lives in PostgreSQL

Capacity, ticket allocation and "one patient at a time" are partial unique
indexes, not application locks. The mutating path is: `FOR UPDATE` on the
session row → precondition in the `WHERE` clause → `rowCount = 0` means the
caller's intent is already achieved, so return current state with a 200 rather
than an error. A unique violation becomes a 409 carrying fresh state, never a
constraint name.

### Contracts

`libs/contracts` is pure TypeScript with no dependencies. Const-object plus a
derived union — **never a TS `enum`**. No zod; server-side validation is
`class-validator` under a global `ValidationPipe` with `whitelist` and
`forbidNonWhitelisted`, so a DTO must declare every field it accepts.

When a contract already declares a response shape, implement _that_ shape.
`ParentQueueView` and `QueueBoard` were both declared long before their
endpoints existed, and shipping an ad-hoc shape beside them cost a rewrite.

---

## Frontend

Both apps consume one token layer, `@clinic/client-theme`; mobile maps it onto
Ionic's `--ion-*` variables, the dashboard builds its own `.d*` primitives.
Anything both apps need to behave _identically_ goes in `@clinic/client-ui` —
which must render without Ionic, because the dashboard has none, and its own
eslint config refuses the import.

- **RTL from the first frame.** Logical CSS properties (`inline-size`,
  `margin-inline-start`, `border-inline-end`), never `left`/`right`.
- **Arabic-Indic numerals come from `arabicDigits()`**, a string transform,
  display-only. `font-feature-settings: 'anum'` renders plain Latin digits in
  the fonts this product ships and looks correct in review.
- **Times are formatted in the clinic's timezone**, never the device's. Around
  midnight the two disagree about the _day_.
- **`vue-router` 5**: guards return their answer; `next()` is deprecated. The
  mobile app must use `@ionic/vue-router`, not plain `vue-router`, or page
  transitions break.
- After changing a shared library's exports, **restart the dev server** — Vite
  caches the module graph and will keep serving the old barrel.

### Live data

`usePolling` and `createSequence` in `@clinic/client-ui` are shared by both
apps. Dashboard polls 5 s, mobile 15 s; one loop per view, paused while the
screen is hidden, immediate full read on return, immediate refresh after the
user's own action, and a sequence guard so a slow response cannot overwrite a
newer one. **Polling, not Supabase Realtime** — Realtime would authorise via RLS
on tables the publishable key can reach, which is exactly what the `clinic`
schema exists to prevent.

A background poll must never blank a screen someone is reading: `loading` is
for the first read only, and a failed poll keeps the last known state.

---

## Product rules that look like implementation details

These have been decided and reversing one is a product conversation, not a
refactor.

- **An appointment is not a place in the queue.** A queue entry is created at
  check-in or walk-in registration, never in advance. A walk-in has
  `appointment_id = NULL`; no appointment row is ever fabricated to satisfy the
  queue.
- **A parent sees a count and their own row.** No clinic queue, no other
  patient's name or ticket number. `ParentQueueItem` has nowhere to put one —
  the privacy property is carried by the shape, not by a filter someone must
  remember.
- **No fake precision.** "أمامك ٣ حالات" is a fact; a ticking countdown to your
  turn is a promise the clinic cannot keep. The only exact countdown allowed is
  `graceExpiresAt`, because that is a real deadline the clinic set. Reaching
  zero refreshes from the API; it never invents the next state.
- **Another family's resource answers 404, not 403** — 403 confirms it exists.
- **`clinicId` never arrives from a request.** It is resolved from the token,
  every time.
- **Capacity, window length, working hours and grace all come from the
  backend.** Nothing time-related is hardcoded in a `.vue` file.
- Staff commands are named routes, never `PATCH {status}`. A dropdown offers
  transitions the server refuses and then has to explain a refusal it invited.

---

## Conventions

- Domain services take `db: SqlExecutor = this.database` as a trailing
  parameter. **Never nest `database.transaction()`** — pass the executor down.
  Parameterised SQL only; no ORM; `pg` is banned outside `server-core`.
- `apps/api` is composition only. Controllers live with their domain.
- Commits are small and each must leave the repository green. End messages with
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `UI/` is the exported design prototype, git-ignored, ~33 MB. Read it when
  building a screen. Three things in it are deliberately not implemented — see
  [docs/status.md](docs/status.md) §4 before adding them.

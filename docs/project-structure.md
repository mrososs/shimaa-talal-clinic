# Project structure

Every application and library in the workspace, what it owns, and what it is
forbidden from owning.

---

## Layout

```text
clinic-platform/
│
├── apps/
│   ├── mobile/           Ionic Vue + Capacitor app       (Vite,  port 4200)
│   ├── dashboard/        Vue web app for clinic staff    (Vite,  port 4201)
│   └── api/              NestJS API                      (webpack, port 3000)
│
├── libs/
│   ├── contracts/        Pure TypeScript shared vocabulary
│   │
│   ├── shared/           Platform-agnostic helpers
│   │   └── phone/        E.164 normalisation (the one place phones are parsed)
│   │
│   ├── client/           Frontend-only libraries
│   │   ├── api-client/   The single HTTP seam to the API
│   │   ├── auth/         Supabase session boundary
│   │   ├── config/       The single reader of import.meta.env
│   │   ├── session/      The signed-in session, shared by both apps
│   │   ├── theme/        The design token layer both apps consume
│   │   └── ui/           What both apps must render identically:
│   │                     the dialog, and the polling lifecycle
│   │
│   └── server/           Backend-only libraries
│       ├── core/         config · database · supabase · auth · common
│       ├── clinic/       Tenancy, staff, schedules, sessions
│       ├── booking/      Appointments and availability
│       ├── queue/        The live queue: ordering and commands
│       ├── payments/     Payments domain boundary       (empty seam)
│       ├── patients/     Guardians, children, claim codes
│       ├── notifications/ Notifications boundary        (empty seam)
│       └── workflows/    Cross-domain writes, and reads that span domains
│
├── supabase/
│   ├── migrations/       Source of truth for the database schema
│   ├── seed.sql          Local seed data (intentionally empty)
│   └── config.toml       Local Supabase stack configuration
│
├── docs/
├── .env.example          Environment template, public vs secret separated
├── eslint.config.mjs     Boundary rules live here
├── nx.json
├── package.json          The only package.json (integrated workspace)
├── pnpm-workspace.yaml   pnpm settings; declares no packages
└── tsconfig.base.json    @clinic/* path mappings
```

---

## Applications

Applications compose libraries. They are thin, they carry no `scope:` tag
(composing every domain is their job), and nothing may depend on them.

### `apps/mobile` — `type:app`, `platform:mobile`

Ionic Vue shell for patients and guardians, packaged natively by Capacitor.

|                  |                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contains         | `main.ts` bootstrap, `App.vue` (`ion-app` + `ion-router-outlet`), one route, one placeholder page, `runtime.ts` composition root, `capacitor.config.ts`                                                                                   |
| Does not contain | Product screens, design, CSS system, native plugins                                                                                                                                                                                       |
| Router           | `@ionic/vue-router` — **not** `vue-router` directly, or page transitions and the native navigation stack break                                                                                                                            |
| Styling          | Ionic's four required baseline stylesheets (`core`, `normalize`, `structure`, `typography`), imported in `main.ts`. These are a functional requirement, not a theme: without them Ionic components have no layout. `styles.css` is empty. |
| Build output     | `dist/apps/mobile`, which is what Capacitor's `webDir` points at                                                                                                                                                                          |
| Extra targets    | `cap-add-android`, `cap-add-ios`, `cap-sync`, `cap-open-android`, `cap-open-ios`                                                                                                                                                          |

### `apps/dashboard` — `type:app`, `platform:dashboard`

Web app for reception, doctors and administrators.

|                  |                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------- |
| Contains         | `main.ts`, `App.vue` (`router-view`), one route, one placeholder page, `runtime.ts` |
| Does not contain | Any UI framework or design system — none has been chosen                            |
| Router           | `vue-router`                                                                        |
| Boundary note    | Lint forbids it from importing `@ionic/*` or `@capacitor/*`                         |

### `apps/api` — `type:app`, `platform:server`

The NestJS application. **Composition only.**

|                         |                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/main.ts`           | Bootstrap: global prefix `api`, URI versioning (default `1`), CORS, `ValidationPipe`, global `ApiExceptionFilter`        |
| `src/app/app.module.ts` | Imports `ServerCoreModule`, `HealthModule`, `ClinicModule`, the five domain modules and `WorkflowsModule`. Owns nothing. |
| `src/app/health/`       | `GET /api/v1/health` → `{ "status": "ok", "service", "timestamp" }`                                                      |
| Must not contain        | Business logic. It belongs in `libs/server/<domain>`.                                                                    |

---

## Shared library

### `libs/contracts` → `@clinic/contracts` — `type:contract`, `platform:shared`, `scope:shared`

The vocabulary all three applications agree on. **Pure TypeScript.** Lint bans
`vue`, `vue-router`, `@vue/*`, `@ionic/*`, `@capacitor/*`, `@nestjs/*`,
`@supabase/*`, `express`, `rxjs` and `pg` here, and it may depend on no other
library.

| Group                | Exports                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Response envelope    | `ApiResponse<T>`, `ApiSuccess<T>`, `ApiFailure`, `isApiSuccess`                                                    |
| Routing              | `API_PREFIX`, `API_VERSION`, `API_BASE_PATH`, `ApiResource`, `ApiCommand`                                          |
| Pagination           | `PageRequest`, `PageMeta`, `Paginated<T>`, `normalizePageRequest`                                                  |
| Time                 | `IsoInstant`, `IsoDate` — an instant, versus a day in the clinic's timezone                                        |
| Roles                | `UserRole`, `ClinicMemberRole` (the staff subset, derived from it), `ClinicMemberStatus`                           |
| Identity             | `Clinic`, `ClinicMember`, `Guardian`, `Child`, `GuardianChild`, `GuardianRelationship`, `ChildSex`                 |
| Sessions             | `ClinicSession`, `ClinicSessionKind`, `ClinicSessionStatus`, `DoctorPresence`                                      |
| Booking              | `Appointment`, `AppointmentStatus`, `AppointmentCancelledBy`, `VisitType`, `AvailabilityWindow`, `AvailabilityDay` |
| Queue                | `QueueEntry`, `QueueStatus`, `QueueEntrySource`, `QueueBoard`, `ParentQueueView`, `isUnchanged`                    |
| Payments (seam only) | `PaymentStatus`                                                                                                    |
| Health               | `HealthCheckResult`                                                                                                |

Three things are deliberately **not** here, because exposing them would let a
client undo a decision the server owns:

- an appointment's **seat number**, which would let a screen render a
  minute-level time and turn an arrival window back into an appointment slot;
- a queue entry's **sort key** and numeric **priority**, which a client that
  could see them would be tempted to sort by. Order is the server's answer,
  delivered as the order of the array;
- a guardian's **auth user id**. Clients get `hasAccount`, which is the only
  part of it they need.

Status values are `const` objects plus a derived union type rather than TS
`enum`s: they erase cleanly, survive `isolatedModules`, and serialise as the
plain strings the database stores.

**This library must stay small.** It is a contract, not a utility drawer. The
test: does this cross the API boundary? A status a client renders or a shape
an endpoint returns belongs here, because the alternative is declaring it
twice and watching the copies drift — that holds even when only one of the two
frontends uses it. Anything one side uses alone does not.

---

## Frontend libraries (`libs/client`)

All tagged `platform:client`, `scope:shared`. Lint forbids them from importing
`@nestjs/*` or anything under `libs/server`.

These are three libraries rather than one because their dependency footprints
differ and that difference reaches the browser bundle: `config` pulls in
nothing, while `auth` pulls in the Supabase SDK. Code that only needs
configuration should not drag an SDK into the bundle with it.

### `libs/client/config` → `@clinic/client-config` — `type:util`

The only place a frontend reads `import.meta.env`.

- `readClientConfig(env)` — pure, testable.
- `getClientConfig()` — memoised read of the running app's environment.
- `isSupabaseConfigured(config)` — type guard, so callers get compile-time
  narrowing instead of runtime `null` checks.
- `assertNoServerSecrets(env)` — **throws** if any `VITE_` variable holds a
  secret-shaped value: an `sb_secret_...` key, a legacy `service_role` JWT, or a
  `postgres://` connection string. The check is on the **value**, not just the
  name, so `VITE_ANALYTICS_TOKEN=sb_secret_…` is caught too. The offending value
  is never echoed in the error — that would put it in the browser console.

`apiUrl` falls back to `http://localhost:3000/api/v1` and the Supabase values
are nullable, so both apps boot with no `.env` at all.

### `libs/client/api-client` → `@clinic/api-client` — `type:data-access`

The only HTTP seam. Feature code calls a typed method here, never `fetch`.

- `ApiClient` with `get` / `post` / `patch` / `put` / `delete`.
- Owns the base URL, the `Authorization` header, query serialisation.
- Unwraps the `ApiResponse` envelope, so callers receive `T` and catch
  `ApiClientError` — no `if (response.success)` scattered through components.
- `fetchImpl` is injectable, which is how it is unit-tested.
- No booking, queue or payment endpoints. Those arrive with their domains.

### `libs/client/auth` → `@clinic/client-auth` — `type:data-access`

Supabase session boundary. Sessions only — never business data.

- `AuthProvider` interface: `getSession`, `getAccessToken`,
  `onAuthStateChange`, `signOut`.
- `createSupabaseAuthProvider(options)` — the Supabase-backed implementation.
- No sign-in UI or flow exists. This is the seam one will plug into.

---

## Backend libraries (`libs/server`)

All tagged `platform:server`. Lint forbids them from importing `vue`,
`vue-router`, `@vue/*`, `@ionic/*`, `@capacitor/*` or anything under
`libs/client`.

### `libs/server/core` → `@clinic/server-core` — `type:data-access`, `scope:shared`

Infrastructure shared by every domain. **No clinic business rules.**

Concerns as folders inside one library rather than separate Nx libraries: they
are always used together, always by the same consumers, and splitting them would
add a `project.json` / `tsconfig` / `jest.config` set each without creating a
boundary any rule could usefully enforce.

| Folder      | Contents                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/`   | `ServerConfig`, `loadServerConfig` (**the only `process.env` read in the backend**), `ServerConfigModule` (global), `ServerConfigService`                                                |
| `database/` | `DatabaseModule`, `DatabaseService`, `SqlExecutor` — **the only PostgreSQL connection pool.** Transactional business data access                                                         |
| `supabase/` | `SupabaseModule`, `SupabaseService` — **the only `createClient` call.** Supabase's own APIs only: `.admin` (secret key, bypasses RLS), `.forUser(token)` (publishable key, respects RLS) |
| `auth/`     | `AuthenticatedUser`, `TokenVerifier` + `TOKEN_VERIFIER` token, `SupabaseTokenVerifier`, `AuthModule`. **No guard is registered; no route is protected.**                                 |
| `common/`   | `apiSuccess` / `apiFailure` helpers, `ApiExceptionFilter` (registered globally in `main.ts`)                                                                                             |

**`database/` and `supabase/` are separate on purpose.** `supabase-js` speaks
PostgREST over HTTP, where every call is its own implicit transaction, so it
cannot express a multi-statement unit of work. Business data therefore goes
through `DatabaseService` (`pg`), while the Supabase client is reserved for Auth,
Storage and Realtime. `DatabaseService.transaction()` hands the callback an
`SqlExecutor`, so one domain method can run standalone or as a step inside a
larger, cross-domain transaction. `pg` is a banned import for every project
except this one. See [database.md](./database.md).

Configuration fails fast: a missing `SUPABASE_SECRET_KEY` or `DATABASE_URL`
stops the process at startup with a message naming the variable and pointing at
`.env.example`, rather than surfacing as a confusing error on first request.
Setting the legacy `SUPABASE_SERVICE_ROLE_KEY` is rejected outright — this
project uses Supabase's current `sb_secret_...` / `sb_publishable_...` key
model.

### `libs/server/clinic` → `@clinic/server-clinic` — `type:data-access`, `scope:shared`

Tenancy and the operational day: clinics and their policy (timezone, grace
period, consultation pace), clinic members and roles, weekly schedules,
closures, and clinic sessions.

It is `scope:shared` rather than a domain of its own because three consumers
need it and a domain may only depend on itself and `scope:shared`: booking
reads sessions to compute availability, queue writes their operational state,
and patients needs clinic members to attribute staff actions. A `scope:clinic`
tag would need a new lint rule per consumer for no benefit. It is genuinely
shared reference and tenancy data, not a business engine.

`type:data-access` means it may hold repositories and narrow state
transitions — but no product rules. "Is this appointment eligible for
check-in" belongs to booking.

Empty today: the schema lands with the identity and scheduling migrations.

### `libs/server/workflows` → `@clinic/server-workflows` — `type:workflow`, `scope:orchestration`

The one project allowed to depend on several domains at once. Domains stay
unaware of each other and of this library — the rule is one-directional.

Empty today. Phase 2 brings exactly three workflows: check in an appointment
(booking + patients + queue), complete a queue entry (queue + booking), and
cancel an appointment (booking + queue). Each opens one transaction and passes
the `SqlExecutor` down, so every domain writes in the same commit. See
[cross-domain-orchestration.md](./cross-domain-orchestration.md).

### The five domain libraries — `type:feature`, `platform:server`, `scope:<domain>`

| Library         | Import path                    | Owns (Phase 2)                                                                                       | Ships today                                                                  |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `booking`       | `@clinic/server-booking`       | Appointments, availability, booking lifecycle, rescheduling, cancellation                            | `BookingModule` only                                                         |
| `queue`         | `@clinic/server-queue`         | Check-in, live queue, serving order, missed turns, grace periods, emergency insertion, doctor delays | `QueueModule` only                                                           |
| `payments`      | `@clinic/server-payments`      | Payment records and status, verification, refunds                                                    | `PaymentsModule` + `PaymentProvider` / `PAYMENT_PROVIDER` seam               |
| `patients`      | `@clinic/server-patients`      | Guardian identity, children, clinic records, account claiming                                        | `PatientsModule` only                                                        |
| `notifications` | `@clinic/server-notifications` | WhatsApp, SMS, push                                                                                  | `NotificationsModule` + `NotificationChannel` / `NOTIFICATION_CHANNELS` seam |

Each module imports `ServerCoreModule` and declares no controllers, providers or
exports. The import is not ceremony: it establishes the dependency direction in
the project graph and puts it under lint enforcement before any code exists to
get it wrong.

Neither provider seam has an implementation registered. Nothing in this
repository can charge a card or send a message to a patient.

Domains are islands: `scope:booking` may depend on `scope:shared`, never on
`scope:queue`. Cross-domain traffic must be a reviewed decision.

---

## Shared helpers (`libs/shared`)

### `libs/shared/phone` → `@clinic/phone` — `type:util`, `platform:shared`

E.164 normalisation, used by the API at the DTO boundary and by both frontends
for display. Phone is the clinic's lookup key — a receptionist types
`0101 234 5678` and must find a guardian stored as `+201012345678` — so the
parsing rule has to exist in exactly one place rather than in every controller
and component. `platform:shared`, so it stays framework-free like `contracts`.

---

## Supabase

| Path                   | Purpose                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `supabase/config.toml` | Local stack: API 54321, DB 54322, Studio 54323, Inbucket 54324. Edge Functions disabled — business logic lives in NestJS. |
| `supabase/migrations/` | **Source of truth for the schema.** One migration, enabling `pgcrypto` and `citext`. No clinic tables.                    |
| `supabase/seed.sql`    | Intentionally empty — there is no schema to seed.                                                                         |

---

## Root files

| File                  | Purpose                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `package.json`        | The only one. Dependencies and `dev:*` / `build` / `lint` / `test` / `graph` scripts.                               |
| `nx.json`             | Named inputs and inferred-target plugins (`@nx/eslint`, `@nx/vite`, `@nx/vitest`).                                  |
| `tsconfig.base.json`  | `@clinic/*` path mappings. No `baseUrl` — deprecated in TS 6, removed in TS 7; paths resolve relative to this file. |
| `eslint.config.mjs`   | **Where the architecture is enforced.** See [dependency-rules.md](./dependency-rules.md).                           |
| `pnpm-workspace.yaml` | pnpm settings only; declares no packages.                                                                           |
| `.env.example`        | Environment template with public and secret values explicitly separated.                                            |

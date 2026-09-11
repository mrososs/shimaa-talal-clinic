# Local development

---

## Prerequisites

| Tool                   | Version                    | Notes                                                                                                   |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Node.js                | >= 20 (developed on 24.11) |                                                                                                         |
| pnpm                   | >= 10 (developed on 11.22) | `npm i -g pnpm`                                                                                         |
| Docker                 | any recent                 | Only for the local Supabase stack                                                                       |
| Supabase CLI           | latest                     | Only for the local Supabase stack — [install guide](https://supabase.com/docs/guides/local-development) |
| Android Studio / Xcode | —                          | Only when building native mobile                                                                        |

Docker and the Supabase CLI are **not** required to run the three applications.
The frontends boot with no configuration at all; the API needs three environment
variables (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`), which can
point at a hosted Supabase project instead of a local one.

---

## 1. Install

```bash
pnpm install
```

One install for the whole workspace — this is an integrated Nx monorepo with a
single root `package.json`.

---

## 2. Environment variables

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

`.env` is git-ignored. Read the header of `.env.example` before filling it in —
it explains the split that matters.

### The split

|         | Server-only            | Public                               |
| ------- | ---------------------- | ------------------------------------ |
| Prefix  | none                   | `VITE_`                              |
| Read by | the NestJS API process | Vite, inlined into browser bundles   |
| Secret? | **yes**                | **no — assume users can read these** |

### Supabase key model

This project uses Supabase's **current** API keys, not the legacy `anon` /
`service_role` JWTs:

| Key                  | Variable                                                                      | Secret?                 |
| -------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| `sb_secret_...`      | `SUPABASE_SECRET_KEY`                                                         | **yes** — bypasses RLS  |
| `sb_publishable_...` | `VITE_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_PUBLISHABLE_KEY` on the server | no — constrained by RLS |

Setting `SUPABASE_SERVICE_ROLE_KEY` makes the API **refuse to start**, with a
message telling you to rename it. A stale deployment should fail loudly.

`libs/client/config` throws if any `VITE_` variable holds a value that _looks_
like a secret — an `sb_secret_...` key, a legacy `service_role` JWT, or a
`postgres://` connection string — whatever the variable is called. That guard is
a backstop; the real defence is not writing one.

### Variables

**Server-only** (`apps/api`)

| Variable                         | Required | Default                           | Notes                                                        |
| -------------------------------- | -------- | --------------------------------- | ------------------------------------------------------------ |
| `SUPABASE_URL`                   | **yes**  | —                                 | `http://127.0.0.1:54321` locally                             |
| `SUPABASE_SECRET_KEY`            | **yes**  | —                                 | **Secret.** `sb_secret_...`; bypasses RLS                    |
| `SUPABASE_PUBLISHABLE_KEY`       | no       | —                                 | Enables `SupabaseService.forUser()` (RLS-respecting clients) |
| `DATABASE_URL`                   | **yes**  | —                                 | **Secret.** Direct PostgreSQL connection for business data   |
| `DATABASE_POOL_MAX`              | no       | `10`                              | Pooled connections **per process**                           |
| `DATABASE_CONNECTION_TIMEOUT_MS` | no       | `10000`                           | Wait for a free connection                                   |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | no       | `15000`                           | Server-side cap on one statement                             |
| `DATABASE_SSL`                   | no       | `true` when `NODE_ENV=production` | Hosted Supabase requires TLS; a local container has none     |
| `API_PORT`                       | no       | `3000`                            |                                                              |
| `API_CORS_ORIGINS`               | no       | `*`                               | Comma-separated. Set explicit origins in production          |
| `NODE_ENV`                       | no       | `development`                     |                                                              |

**Public** (`apps/mobile`, `apps/dashboard`)

| Variable                        | Required | Default                        |
| ------------------------------- | -------- | ------------------------------ |
| `VITE_API_URL`                  | no       | `http://localhost:3000/api/v1` |
| `VITE_MOBILE_APP_URL`           | no       | `http://localhost:4202`        |
| `VITE_SUPABASE_URL`             | no       | —                              |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | no       | —                              |
| `VITE_APP_ENV`                  | no       | `development`                  |

There is deliberately no `VITE_DATABASE_*` variable: frontends never connect to
PostgreSQL. Lint bans `pg` from every client-side project.

The API **fails to start** if `SUPABASE_URL`, `SUPABASE_SECRET_KEY` or
`DATABASE_URL` is missing, naming the variable in the error. This is
intentional: a backend that boots half-configured fails later, in a more
confusing place.

`DATABASE_URL` is validated as a connection string at startup, but `pg` connects
lazily — the API boots even if Postgres is unreachable, and the first query is
where that surfaces.

Configuration is read in exactly one file — `libs/server/core/src/lib/config/`
on the server, `libs/client/config` on the frontends. Do not add `process.env`
or `import.meta.env` reads elsewhere.

---

## 3. The database and Supabase locally

`supabase start` runs both: the Supabase APIs _and_ the PostgreSQL instance the
API connects to directly. Skip it only if you are pointing at a hosted project.

```bash
supabase start        # or: pnpm supabase:start
```

First run pulls several Docker images and takes a few minutes. Copy the printed
values into `.env`:

| Printed as      | Goes to                                                            |
| --------------- | ------------------------------------------------------------------ |
| `API URL`       | `SUPABASE_URL` **and** `VITE_SUPABASE_URL`                         |
| secret key      | `SUPABASE_SECRET_KEY` **only** — never a `VITE_` variable          |
| publishable key | `SUPABASE_PUBLISHABLE_KEY` **and** `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `DB URL`        | `DATABASE_URL`                                                     |

Older CLI versions print `anon key` and `service_role key` instead. If yours
does, upgrade it — this project does not use the legacy keys, and the API will
refuse to start if you set `SUPABASE_SERVICE_ROLE_KEY`.

The local `DATABASE_URL` is normally:

```
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Local services: API `54321`, Postgres `54322`, Studio `54323` (browser UI),
Inbucket `54324` (catches outbound mail, so nothing real is ever sent).

For hosted Supabase, take `DATABASE_URL` from Project Settings → Database →
Connection string, and prefer the **session** pooler for a long-lived Node pool.
Do not use the transaction-mode pooler: it does not preserve session state
across statements, which breaks explicit `BEGIN`/`COMMIT` blocks. See
[database.md](./database.md).

```bash
supabase stop                    # or: pnpm supabase:stop
supabase db reset                # re-apply all migrations + seed.sql
supabase migration new <name>    # create a new migration
```

`supabase/migrations` is **the source of truth** for the database schema. There
is no ORM. Never edit a migration that has already been applied to a shared
environment — add a new one.

The migration set owns the complete private `clinic` schema: identity,
scheduling, Booking, Queue, and tenant-consistency constraints.

### Repeatable Booking and Queue demo

Create the dedicated mobile account once, then rebuild today's demo data:

```bash
# PowerShell
$env:DEMO_ACCOUNT_PASSWORD='<a temporary password of at least 12 characters>'
pnpm demo:accounts
pnpm demo:day
```

`demo:accounts` creates and confirms dedicated doctor, reception and parent
accounts through the server-side Supabase Admin API, then links the two staff
roles to the clinic. If an account already exists, it does not change its
password. `demo:day` is idempotent and transactional: it replaces only
`demo `-prefixed families, and refuses to change a session that contains
non-demo activity.

The fixture includes an in-service patient, normal and emergency waiting
patients, an expired called patient, and confirmed/requested bookings. Remove
the operational rows with `pnpm demo:day:down`; the Auth accounts are retained.

---

## 3.1 The hosted Supabase project

The workspace targets Supabase project **`mdsmnruqfaiugpmhzggv`**.

`.env` is pre-filled with the non-secret values (`SUPABASE_URL`,
`VITE_SUPABASE_URL`). Three values are intentionally left empty and must be
pasted from the dashboard:

| Variable                                                       | Dashboard location                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `SUPABASE_SECRET_KEY`                                          | Project Settings → API Keys → Secret keys (`sb_secret_...`)                               |
| `SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → Publishable key (`sb_publishable_...`) — same value in both |
| `DATABASE_URL`                                                 | Project Settings → Database → Connection string, **session** pooler (port 5432)           |

To point the migration workflow at the hosted project:

```bash
supabase link --project-ref mdsmnruqfaiugpmhzggv
supabase db push          # applies supabase/migrations to the hosted database
```

`supabase/migrations` stays the source of truth either way. `db push` applies
them; it never reads the hosted schema back.

### Supabase MCP server

`.mcp.json` registers Supabase's hosted MCP server at **project scope**, so it
is shared with the team through version control. It contains only the project
ref and a feature list — no credentials.

Each developer authenticates individually:

```
/mcp        # select "supabase", then Authenticate
```

Run that in a real terminal, not an IDE extension. Until you authenticate, the
server's tools are simply unavailable.

Two things worth knowing:

- The configured feature set includes `database`, `functions` and `branching`,
  which means the MCP server can **modify the live project**. It acts with your
  Supabase account's permissions. Prefer running destructive work through
  migrations rather than ad-hoc MCP calls, so the schema stays reproducible.
- The MCP server is a development convenience. It is **not** part of the
  application's runtime path — nothing in `apps/` or `libs/` depends on it.

---

## 4. Running the applications

```bash
pnpm dev:api          # NestJS      http://localhost:3000/api/v1
pnpm dev:dashboard    # Vue         http://localhost:4203
pnpm dev:mobile       # Ionic Vue   http://localhost:4202
```

Each in its own terminal, or all three at once:

```bash
pnpm dev              # nx run-many -t serve -p api dashboard mobile
```

The underlying Nx commands work directly too:

```bash
pnpm nx serve api
pnpm nx serve dashboard
pnpm nx serve mobile
```

`serve` is the standard target name for all three; the mobile app needs no
special naming. Its Capacitor-specific work lives on separate targets — see
section 6.

### Verify

```bash
curl http://localhost:3000/api/v1/health
# {"status":"ok","service":"clinic-api","timestamp":"..."}
```

Then open http://localhost:4202 for the parent Mobile app and
http://localhost:4203 for the clinic Dashboard.

| Service   | Dev  | Preview (built output) |
| --------- | ---- | ---------------------- |
| API       | 3000 | —                      |
| Mobile    | 4202 | 4302                   |
| Dashboard | 4203 | 4303                   |

---

## 5. Build, lint, test

```bash
pnpm build            # nx run-many -t build   (the three applications)
pnpm lint             # nx run-many -t lint    (all projects)
pnpm test             # nx run-many -t test    (all unit/integration projects)
pnpm test:dashboard:e2e # isolated Chrome cross-role journey
pnpm format           # nx format:write
pnpm format:check
```

Scoped to what you changed:

```bash
pnpm nx build api
pnpm nx test contracts
pnpm nx affected -t lint test build     # only projects affected since main
```

`lint` is where the architecture is enforced — an import that crosses a
forbidden boundary fails here. See [dependency-rules.md](./dependency-rules.md).

Nx caches task results. Add `--skip-nx-cache` to force a re-run.

Database-backed server targets should run with project parallelism disabled.
The browser journey creates marked temporary Supabase Auth users and clinic
rows, exercises the real clients and API, and removes the fixture in global
teardown even when an assertion fails.

---

## 6. Native mobile (Capacitor)

Base Capacitor setup is configured; **no native platform has been added and no
native folder is committed.**

```bash
pnpm nx build mobile                 # produces dist/apps/mobile (Capacitor's webDir)

pnpm nx run mobile:cap-add-android   # creates apps/mobile/android
pnpm nx run mobile:cap-add-ios       # creates apps/mobile/ios  (macOS only)

pnpm nx run mobile:cap-sync          # builds, then copies web assets + plugins
pnpm mobile:sync                     # same thing

pnpm nx run mobile:cap-open-android  # syncs, then opens Android Studio
pnpm nx run mobile:cap-open-ios      # syncs, then opens Xcode
```

### Should `android/` and `ios/` be committed?

**Recommendation: no — and `.gitignore` currently excludes both.**

They are generated, large, and regenerable from `capacitor.config.ts` with
`cap add`. Committing them means every Capacitor or Gradle upgrade produces a
huge, unreviewable diff, and merge conflicts in files no one reads.

Reconsider — as a deliberate, documented decision — when the first of these
becomes true, because each requires hand-editing native files that `cap add`
would then overwrite:

- signing configuration, or store metadata that must be version-controlled;
- a native plugin needing manual `AndroidManifest.xml` / `Info.plist` changes;
- custom native code;
- CI that builds native artefacts and cannot run `cap add` first.

Until then, treat native folders as build output. No native plugins are
installed: no camera, push notifications, geolocation, filesystem or biometrics.
Add each when a feature actually needs it.

---

## 7. Inspecting the project graph

```bash
pnpm graph                        # interactive graph in the browser
pnpm nx graph --file=graph.html   # static export
pnpm nx show project api --web    # one project's tags, targets, dependencies
pnpm nx show projects             # list all workspace projects
```

Worth doing after any structural change: the graph shows the real dependency
direction, and any cycle.

---

## 8. Troubleshooting

**API exits immediately with `Missing required environment variable …`**
Working as intended. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`,
`SUPABASE_SECRET_KEY` and `DATABASE_URL`.

**API exits with `SUPABASE_SERVICE_ROLE_KEY is set but this project uses the
current Supabase key model`**
Also intended. Replace it with `SUPABASE_SECRET_KEY` holding an `sb_secret_...`
key from the Supabase dashboard.

**Frontend throws `Server-only secrets were exposed to the client bundle`**
A `VITE_` variable holds a secret-shaped value. The error names the variable but
never prints the value. Move it to an unprefixed variable.

**`ECONNREFUSED` on the first request that touches the database**
`pg` connects lazily, so this appears at query time rather than at boot. Check
`DATABASE_URL` and that Postgres is running (`supabase start`).

**`Cannot find module '@clinic/...'`**
The path mapping is missing from `tsconfig.base.json`. Nx generators add it
automatically — check the library was generated rather than hand-created.

**Lint fails with `@nx/enforce-module-boundaries`**
The import crosses an architectural boundary. Read
[dependency-rules.md](./dependency-rules.md) before reaching for a disable
comment — it is almost always telling you the code is in the wrong place.

**Stale results after changing configuration**
`pnpm nx reset` clears the Nx cache and daemon.

**`supabase start` fails**
Docker must be running. `supabase stop --no-backup` then `supabase start` clears
a wedged stack.

**pnpm reports ignored build scripts**
pnpm requires explicit approval for install scripts. Add the package to
`allowBuilds` in `pnpm-workspace.yaml` and re-run `pnpm install`.

---

## 9. Known warnings

**`unmet peer vue-router: wanted ^4.0.0 by @nx/vue`**
Expected. Ionic Vue 9 targets vue-router 5, which is what is installed; the
peer range in `@nx/vue` only affects Nx's own Vue _generators_, not the built
applications. Harmless — do not "fix" it by downgrading vue-router, which would
break Ionic.

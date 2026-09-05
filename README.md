# Clinic Operating Platform

Nx monorepo for the clinic platform: an Ionic Vue mobile app, a Vue staff
dashboard, and a NestJS API backed by Supabase.

> **Status: architecture foundation.**
> Booking, queue, payments, patients and notifications exist as _empty,
> boundary-enforced module skeletons_. There is no business logic, no clinic
> database schema, no UI design, no payment provider and no notification
> provider. That is deliberate — see
> [docs/architecture.md](docs/architecture.md).

---

## Quick start

```bash
pnpm install
# .env is already present with the non-secret values for the Supabase project.
# Paste SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY and DATABASE_URL into it.
# Starting fresh? cp .env.example .env   (PowerShell: Copy-Item .env.example .env)

pnpm dev:api                # http://localhost:3000/api/v1
pnpm dev:dashboard          # http://localhost:4201
pnpm dev:mobile             # http://localhost:4200
```

```bash
curl http://localhost:3000/api/v1/health
# {"status":"ok","service":"clinic-api","timestamp":"..."}
```

The frontends need no configuration to boot. The API needs three variables and
fails fast without them.

---

## Layout

```text
apps/
  mobile/        Ionic Vue + Capacitor        (Vite,    4200)
  dashboard/     Vue web app for staff        (Vite,    4201)
  api/           NestJS, thin composition     (webpack, 3000)

libs/
  contracts/     Pure TypeScript vocabulary shared by all three
  client/        api-client · auth · config   (frontend only)
  server/        core + booking · queue · payments · patients · notifications
                 core = config · database · supabase · auth · common

supabase/        migrations (schema source of truth) · seed.sql · config.toml
docs/            architecture · project-structure · dependency-rules · local-development
```

---

## Commands

| Command                                         | Does                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev:mobile` / `dev:dashboard` / `dev:api` | Serve one application                                             |
| `pnpm dev`                                      | Serve all three                                                   |
| `pnpm build`                                    | Build the three applications                                      |
| `pnpm lint`                                     | Lint all 13 projects — **this is where architecture is enforced** |
| `pnpm test`                                     | Run all unit tests                                                |
| `pnpm typecheck`                                | Type-check projects exposing a typecheck target                   |
| `pnpm graph`                                    | Open the interactive project graph                                |
| `pnpm format`                                   | Format with Prettier via Nx                                       |
| `pnpm mobile:sync`                              | Build the mobile app and run `cap sync`                           |
| `pnpm supabase:start` / `supabase:stop`         | Local Supabase stack (needs Docker + Supabase CLI)                |

Scope any of them: `pnpm nx test contracts`, `pnpm nx affected -t lint test`.

---

## The rules worth knowing before you commit

1. **Frontends never write business data.** They use Supabase Auth for login and
   sessions only; every business mutation goes through the NestJS API.
   [Why.](docs/architecture.md#6-the-frontend--backend-boundary)

2. **No secret ever gets a `VITE_` prefix.** `SUPABASE_SECRET_KEY` and
   `DATABASE_URL` are server-only. `libs/client/config` throws if any `VITE_`
   variable holds a secret-shaped value, whatever it is called.

3. **Business data goes through `DatabaseService`, not `supabase-js`.**
   PostgREST cannot run a multi-statement transaction. Supabase's client is for
   Auth, Storage and Realtime. [Why.](docs/database.md)

4. **Business logic never goes in `apps/api/src`.** The application composes
   modules; domains live in `libs/server/<domain>`.

5. **Domains never import each other.** Cross-domain workflows go through a
   future orchestration layer, not a relaxed rule.
   [Pattern.](docs/cross-domain-orchestration.md)

Rules 1–5 are backed by
[`@nx/enforce-module-boundaries`](docs/dependency-rules.md) at lint time, not by
convention. Booking, Queue and Payments are **separate engines** — the
architecture deliberately does not encode a `Booking → Queue → Payment`
pipeline.

---

## Documentation

| Document                                                            | Read it for                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| [architecture.md](docs/architecture.md)                             | The system diagram and the reasoning behind every major choice |
| [database.md](docs/database.md)                                     | The transactional data seam, connections, grants and RLS       |
| [cross-domain-orchestration.md](docs/cross-domain-orchestration.md) | How multi-domain workflows will be coordinated                 |
| [project-structure.md](docs/project-structure.md)                   | What each app and library owns                                 |
| [dependency-rules.md](docs/dependency-rules.md)                     | The tags and the enforced boundaries                           |
| [local-development.md](docs/local-development.md)                   | Setup, environment, Supabase, Capacitor, troubleshooting       |

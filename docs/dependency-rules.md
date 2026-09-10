# Dependency rules

The architecture in [architecture.md](./architecture.md) is not a convention —
it is a lint rule. This document explains the tags, the constraints they
produce, and how to work with them.

Everything here is implemented by `@nx/enforce-module-boundaries` in
`eslint.config.mjs`, and runs on every `nx lint`.

---

## The intended direction

```text
Applications              apps/mobile · apps/dashboard · apps/api
      │
      ▼
Workflow libraries        libs/server/workflows
      │
      ▼
Feature libraries         libs/server/{booking,queue,payments,patients,notifications}
      │
      ▼
Data-access libraries     libs/client/{api-client,auth} · libs/server/{core,clinic}
      │
      ▼
Utilities                 libs/client/config · libs/shared/phone
      │
      ▼
Contracts                 libs/contracts
```

Dependencies flow **downward only**. Nothing depends on an application.
`libs/contracts` depends on nothing.

---

## The three tag dimensions

Every project carries tags on three orthogonal axes. A project must satisfy
**every** rule whose `sourceTag` it matches — the constraints intersect.

### `type:` — which layer

| Tag                | Meaning                     | Projects                                                    |
| ------------------ | --------------------------- | ----------------------------------------------------------- |
| `type:app`         | Deployable application      | `mobile`, `dashboard`, `api`                                |
| `type:workflow`    | Cross-domain orchestration  | `server-workflows`                                          |
| `type:feature`     | Business domain module      | the five `server-*` domain libraries                        |
| `type:data-access` | Talks to an external system | `api-client`, `client-auth`, `server-core`, `server-clinic` |
| `type:util`        | Pure helpers, no I/O        | `client-config`, `phone`                                    |
| `type:contract`    | Shared types and constants  | `contracts`                                                 |
| `type:e2e`         | Release-level test harness  | `dashboard-e2e`                                             |

### `platform:` — which runtime

| Tag                  | Meaning                    | Projects                           |
| -------------------- | -------------------------- | ---------------------------------- |
| `platform:mobile`    | The Ionic/Capacitor shell  | `mobile`                           |
| `platform:dashboard` | The staff web app          | `dashboard`                        |
| `platform:client`    | Any frontend               | the three `libs/client` libraries  |
| `platform:server`    | Node/NestJS                | `api`, all `libs/server` libraries |
| `platform:shared`    | Must run anywhere          | `contracts`, `phone`               |
| `platform:e2e`       | Node setup + real browsers | `dashboard-e2e`                    |

### `scope:` — which business domain

| Tag                                                                                | Projects                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `scope:booking` / `queue` / `payments` / `patients` / `clinical` / `notifications` | the matching domain library                                                       |
| `scope:shared`                                                                     | `contracts`, `server-core`, `server-clinic`, `phone`, all `libs/client` libraries |
| `scope:orchestration`                                                              | `server-workflows`                                                                |
| _(none)_                                                                           | the three applications                                                            |

**Applications deliberately carry no `scope:` tag.** Composing every domain is
exactly their job, and a project with no `scope:` tag matches no scope rule.

---

## The rules

### Platform — keeps runtimes apart

| A project tagged…    | may depend only on…                                        | and may never import                                                                                           |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `platform:mobile`    | `platform:mobile`, `platform:client`, `platform:shared`    | `@nestjs/*`, `pg`                                                                                              |
| `platform:dashboard` | `platform:dashboard`, `platform:client`, `platform:shared` | `@nestjs/*`, `@ionic/*`, `@capacitor/*`, `pg`                                                                  |
| `platform:client`    | `platform:client`, `platform:shared`                       | `@nestjs/*`, `pg`                                                                                              |
| `platform:server`    | `platform:server`, `platform:shared`                       | `vue`, `vue-router`, `@vue/*`, `@ionic/*`, `@capacitor/*`                                                      |
| `platform:shared`    | `platform:shared`                                          | `vue`, `vue-router`, `@vue/*`, `@ionic/*`, `@capacitor/*`, `@nestjs/*`, `@supabase/*`, `express`, `rxjs`, `pg` |
| `platform:e2e`       | every platform tag, including `platform:e2e`               | —                                                                                                              |

The `pg` bans on client platforms are part of the security boundary: a frontend
must not be able to acquire a database connection at all, not merely be trusted
not to. See [architecture.md](./architecture.md#defence-in-depth-not-convention).

This is what satisfies the two rules stated at the outset:

- **Frontend code can never import `libs/server/*`** — no client platform tag
  lists `platform:server`.
- **Backend libraries can never depend on `libs/client/*`** — `platform:server`
  does not list `platform:client`.

And it is what keeps `@clinic/contracts` genuinely framework-agnostic: the
`platform:shared` row bans every framework by name.

The dashboard's ban on `@ionic/*` and `@capacitor/*` is deliberate. Nothing
technically stops Ionic components rendering in a desktop web app, but the
staff dashboard is a keyboard-and-mouse tool and should not inherit a mobile
component library by accident.

### Type — keeps layers ordered

| A project tagged…  | may depend only on…                                                               | and may never import |
| ------------------ | --------------------------------------------------------------------------------- | -------------------- |
| `type:app`         | `type:workflow`, `type:feature`, `type:data-access`, `type:util`, `type:contract` | `pg`                 |
| `type:workflow`    | `type:feature`, `type:data-access`, `type:util`, `type:contract`                  | `pg`                 |
| `type:feature`     | `type:data-access`, `type:util`, `type:contract`                                  | `pg`                 |
| `type:data-access` | `type:data-access`, `type:util`, `type:contract`                                  | —                    |
| `type:util`        | `type:util`, `type:contract`                                                      | —                    |
| `type:contract`    | `type:contract`                                                                   | —                    |
| `type:e2e`         | every type tag, including `type:e2e`                                              | —                    |

No row lists `type:app`, so **nothing can depend on an application**.
`type:feature` does not list `type:feature`, so domain modules cannot reach each
other through the type axis either.

`type:workflow` exists precisely _because_ of that second sentence.
Orchestration has to depend on several `type:feature` libraries, so it
cannot itself be `type:feature`: the constraints intersect, and a
`type:feature` project is forbidden from importing `type:feature`. Widening
`type:feature` to allow it would let every domain import every other domain —
the exact failure this file exists to prevent. So orchestration gets its own
layer above the domains instead.

Verified by deliberate violation: tagged `type:feature`, `server-workflows`
is blocked from importing `@clinic/server-booking`; tagged `type:workflow`,
it is allowed — while `server-booking` importing `@clinic/server-workflows`
stays blocked.

`pg` is banned from production layers except `type:data-access` — in practice,
only `server-core`. The separate `type:e2e` harness may use it to provision and
clean isolated fixtures. This keeps each deployed API process to **exactly one connection pool** and
forces domain modules to take an `SqlExecutor` instead of opening their own
connection, which is what makes a domain method callable inside someone else's
transaction. `QueryResult` and `QueryResultRow` are re-exported from
`@clinic/server-core`, so domains never need the direct import. See
[database.md](./database.md).

### Scope — keeps domains as islands

| A project tagged…     | may depend only on…                   |
| --------------------- | ------------------------------------- |
| `scope:booking`       | `scope:booking`, `scope:shared`       |
| `scope:queue`         | `scope:queue`, `scope:shared`         |
| `scope:payments`      | `scope:payments`, `scope:shared`      |
| `scope:patients`      | `scope:patients`, `scope:shared`      |
| `scope:clinical`      | `scope:clinical`, `scope:shared`      |
| `scope:notifications` | `scope:notifications`, `scope:shared` |
| `scope:shared`        | `scope:shared`                        |
| `scope:orchestration` | every `scope:*` above                 |

This is the rule that keeps the modular monolith modular. Booking cannot reach
into queue's internals; both reach shared infrastructure.

It also keeps the product model neutral. Nothing here encodes
`Booking → Queue → Payment`: they are separate engines, and a payment or a queue
entry may arise in several ways that a fixed pipeline would forbid.

Workflows that genuinely span domains are **not** solved by relaxing this rule.
They belong to `libs/server/workflows` — the one project allowed to depend on
many domains, while the domains stay unaware of each other. The asymmetry is the
whole point, and it is one-directional: nothing lists `scope:orchestration` as
a permitted dependency, so no domain can ever depend back on it. See
[cross-domain-orchestration.md](./cross-domain-orchestration.md).

`scope:shared` depending only on `scope:shared` means shared infrastructure can
never depend on a specific domain, which is what stops `contracts` and
`server-core` slowly absorbing booking logic.

---

## Verified, not assumed

These rules were checked by deliberately violating them.

Importing `@clinic/server-booking` from `apps/dashboard`:

```
error  A project tagged with "platform:dashboard" can only depend on libs tagged
       with "platform:dashboard", "platform:client", "platform:shared"
       @nx/enforce-module-boundaries
```

Importing `@nestjs/common` from `libs/contracts`:

```
error  A project tagged with "platform:shared" is not allowed to import
       "@nestjs/common"    @nx/enforce-module-boundaries
```

Both probe files were removed afterwards. Re-run either check any time the
rules change — a boundary rule that never fires is worth nothing.

---

## Circular dependencies

Nx detects import cycles and fails the build. The tag rules make most cycles
impossible before that point: the `type:` axis is a strict downward ordering,
and no layer may depend on the one above it.

Run `nx graph` and look for cycles after any structural change.

---

## Working with the rules

**Adding a library.** Generate it with tags, never by hand:

```bash
# a backend domain library
pnpm nx g @nx/nest:library libs/server/<domain> \
  --name=server-<domain> --importPath=@clinic/server-<domain> \
  --tags="type:feature,platform:server,scope:<domain>" --useProjectJson

# a frontend library
pnpm nx g @nx/js:library libs/client/<name> \
  --name=<name> --importPath=@clinic/<name> --bundler=none \
  --tags="type:data-access,platform:client,scope:shared" --useProjectJson

# the cross-domain workflow library (there is one, and one is likely enough)
pnpm nx g @nx/nest:library libs/server/workflows \n  --name=server-workflows --importPath=@clinic/server-workflows \n  --unitTestRunner=jest --strict --useProjectJson \n  --tags="type:workflow,platform:server,scope:orchestration"
```

A new `scope:` value needs a matching rule in `eslint.config.mjs` — without one
the domain is unconstrained.

**When a rule blocks you.** It is usually right. In order of preference:

1. **Move the code.** Shared code belongs in `contracts` (if pure) or
   `server-core` / a `libs/client` library (if it needs infrastructure).
2. **Invert the dependency.** Define the interface in the consumer and inject
   the implementation, as `TOKEN_VERIFIER`, `PAYMENT_PROVIDER` and
   `NOTIFICATION_CHANNELS` already do.
3. **Change the rule** — deliberately, in a review, and update this document.

Do not reach for `// eslint-disable-next-line @nx/enforce-module-boundaries`. A
disabled boundary is invisible in six months; a changed rule is in the diff.

---

## Inspecting the graph

```bash
pnpm graph                       # interactive project graph
pnpm nx graph --file=graph.html  # static export
pnpm nx show project api --web   # one project's tags, targets and dependencies
```

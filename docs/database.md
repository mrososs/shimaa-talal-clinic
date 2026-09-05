# Database access

Why the backend talks to PostgreSQL directly, how transactions work, how
connections are configured, and how this relates to Supabase and RLS.

---

## 1. Why this seam exists

Supabase is used for two very different things, and conflating them causes a
problem that only surfaces once real workflows are written.

`supabase-js` is a **PostgREST client**. Every call is one HTTP request, and
every HTTP request is its own implicit transaction. There is no
`supabase.begin()`. So this cannot be made atomic:

```ts
// BROKEN: three independent transactions, any of which can fail alone
await supabase
  .from('appointments')
  .update({ status: 'confirmed' })
  .eq('id', id);
await supabase
  .from('payments')
  .insert({ appointment_id: id, status: 'pending' });
await supabase.from('audit_log').insert({ action: 'appointment.confirmed' });
```

If the second call fails, the first is already committed. The system is now in a
state no business rule allows, and there is no way to undo it that is itself
safe. The usual workarounds each have a real cost:

| Workaround                                                   | Why we are not using it                                                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Compensating writes ("undo" calls)                           | Compensation can fail too. You are hand-rolling a saga to solve a problem one `BEGIN` already solves.                                     |
| Push everything into a Postgres function and call it via RPC | Business rules migrate into PL/pgSQL: hard to test, hard to review, invisible to TypeScript. Fine for one hot path, wrong as the default. |
| Accept eventual consistency                                  | For clinic bookings and payments, "temporarily wrong" means a double-booked slot or a charge with no appointment.                         |

So the backend gets a real database connection, and the two concerns are split:

| Concern           | Tool                              | Used for                                                                                     |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| **Supabase APIs** | `SupabaseService` (`supabase-js`) | Auth and token verification, Storage, Realtime later, anything only Supabase can do          |
| **Business data** | `DatabaseService` (`pg`)          | Appointments, queue entries, payment records, patient relationships - anything transactional |

Both live in `libs/server/core`. Domain modules inject them; nothing else
constructs a Supabase client or a connection pool.

### Why `pg` and not an ORM

The brief was a lightweight client, and that is the right call here. Prisma,
TypeORM and Drizzle each introduce a **second schema source of truth** that
competes with `supabase/migrations`, plus a generation step in the build. We
would be maintaining the schema twice and reconciling drift.

[`pg`](https://node-postgres.com) is the reference PostgreSQL driver for Node:
no schema ownership, no codegen, no opinions. `DatabaseService` wraps it in
about sixty lines and exposes exactly two things - parameterised SQL and a
transaction scope.

This is not a repository pattern, a query builder, or a `BaseRepository`. If
query ergonomics later become a real problem, a query builder can be introduced
_behind_ this seam without touching domain code.

**`supabase/migrations` remains the single source of truth for the schema.**
`DatabaseService` reads and writes data; it never defines structure.

---

## 2. How transactions are performed

`DatabaseService.transaction()` checks out one connection, wraps the callback in
`BEGIN` / `COMMIT`, and rolls back if the callback throws.

```ts
await this.database.transaction(async (tx) => {
  await tx.query('update appointments set status = $1 where id = $2', [
    'confirmed',
    appointmentId,
  ]);

  await tx.query(
    'insert into payments (appointment_id, status) values ($1, $2)',
    [appointmentId, 'pending'],
  );

  // Returning commits. Throwing rolls both statements back.
});
```

### The `SqlExecutor` interface is the important part

`transaction()` hands the callback an `SqlExecutor` — the same interface
`DatabaseService` itself implements. Domain methods should accept one:

```ts
// in a domain service
async confirm(id: string, db: SqlExecutor = this.database): Promise<void> {
  await db.query('update appointments set status = $1 where id = $2', ['confirmed', id]);
}
```

That single parameter is what makes the same method usable standalone _and_ as
one step inside a larger transaction — including a transaction opened by an
orchestrator that spans two domains. Without it, every cross-domain workflow
would need bespoke plumbing. See
[cross-domain-orchestration.md](./cross-domain-orchestration.md).

### Rules

- **Always parameterise.** `$1`, `$2`, never string interpolation. RLS will not
  save you from SQL injection.
- **Never nest `transaction()` inside `transaction()`.** The inner call checks
  out a second, independent connection that cannot see the outer transaction's
  uncommitted rows, and can deadlock against it. Pass `tx` down instead.
- **Keep transactions short.** They hold a pooled connection and can hold row
  locks. Never `await` an HTTP call to a payment or notification provider inside
  one.
- **Do not use `DatabaseService` for Supabase Auth or Storage.** Those are
  `SupabaseService`.

A failing `ROLLBACK` is logged but never allowed to mask the original error, and
the connection is released on every path.

---

## 3. How connections are configured

All of it comes from `ServerConfigService`, which reads the environment in one
place. The pool is created once, in `DatabaseModule`.

| Variable                         | Default                           | Purpose                                                                      |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`                   | **required**                      | Connection string. Validated as `postgres://` or `postgresql://` at startup. |
| `DATABASE_POOL_MAX`              | `10`                              | Max pooled connections **per process**.                                      |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `10000`                           | Wait for a free connection before failing.                                   |
| `DATABASE_STATEMENT_TIMEOUT_MS`  | `15000`                           | Server-enforced cap on one statement.                                        |
| `DATABASE_SSL`                   | `true` when `NODE_ENV=production` | TLS. Hosted Supabase requires it; a local container does not offer it.       |

Notes worth knowing before deploying:

- **`pg` connects lazily.** Constructing the pool does not require a reachable
  database, so the API boots even if Postgres is down. The first query is where
  that surfaces. This is intentional: it keeps startup fast and avoids a boot
  ordering dependency.
- **Pool size is per process.** Multiply by your instance count and keep the
  total under the database's connection limit. Supabase's direct connection
  limit is small; if you run several instances, use the **session pooler**
  connection string rather than raising `DATABASE_POOL_MAX`.
- **Do not use the transaction-mode pooler** (PgBouncer in transaction mode) for
  this connection. It does not preserve session state across statements, which
  breaks explicit `BEGIN`/`COMMIT` blocks and prepared statements.
- **TLS** uses `rejectUnauthorized: false` when enabled, because hosted
  Supabase presents a chain that is not in Node's default trust store. The
  connection is still encrypted; supply a CA if a deployment needs full
  verification.

---

## 4. How this interacts with Supabase and RLS

### The layers

```
Browser / Capacitor
   │  Supabase Auth: login, session, token refresh          → allowed
   │  Business reads/writes                                 → NOT allowed
   ▼
NestJS API
   │  business rules and authorisation decisions
   ▼
PostgreSQL
   │  grants + RLS: defence in depth
```

RLS is not the business layer. It is the layer that limits the damage when the
business layer is wrong. Both should be true; neither alone is enough.

### Why RLS still matters when the API is trusted

The API connects as a database role, and by default a table's **owner bypasses
RLS entirely**. If the API connected as the owner (or as `postgres`), every RLS
policy in the database would be decorative from its point of view. A single
missing `where clinic_id = $1` in a query would return every clinic's rows.

So the intended posture, to be established in the first schema migration:

1. **The API gets its own role**, e.g. `clinic_api`. Not `postgres`, not the
   table owner, not Supabase's `service_role`.
2. **Grants are explicit and minimal**: `SELECT`, `INSERT`, `UPDATE`, `DELETE`
   per table as actually needed. No blanket `GRANT ALL`. No `CREATE` — schema
   changes come from migrations, not from the running application.
3. **Tables use `ALTER TABLE ... FORCE ROW LEVEL SECURITY`**, so policies apply
   even to the owner. Without `FORCE`, RLS is silently skipped for the owner and
   the safety net is not there.
4. **Policies are written against a request-scoped identity**, so a bug in one
   query cannot read another tenant's rows.

### Two ways to carry identity into the database

Both are legitimate; the choice is a Phase 2 decision and does not need making
now.

**(a) Trusted API, RLS as a backstop.** The API decides authorisation and
queries as `clinic_api`. Policies enforce coarse invariants (clinic scoping,
soft-delete visibility) rather than per-user rules. Simplest, and adequate when
the API is the only client.

**(b) Request-scoped identity.** The transaction sets local settings before
doing work, and policies read them:

```sql
-- inside the transaction, before domain queries
select set_config('app.user_id', $1, true);   -- `true` = transaction-local
```

This is why identity would be applied _inside_ `transaction()` rather than on
the pooled connection: a pooled connection is reused by the next request, so
anything set with `set_config(..., false)` would leak across users. If we adopt
this, `DatabaseService.transaction()` gains an optional actor parameter and
sets it as the first statement after `BEGIN`. The seam is designed for that;
nothing else has to change.

### What frontends may do against Supabase

Allowed: `signIn`, `signOut`, session refresh, reading the current session — all
via `libs/client/auth`. Later: Storage uploads under RLS, Realtime subscriptions
on read-only views.

Not allowed: inserting, updating or deleting business rows. Those go through the
API. `libs/client` has no database client at all, and lint bans `pg` from every
client-side project, so this is not merely convention.

---

## 5. What does not exist yet

Deliberately:

- **No business tables.** The only migration enables `pgcrypto` and `citext`.
- **No `clinic_api` role or grants.** Grants describe tables; writing them before
  the tables exist would be guesswork. They land with the first domain
  migration.
- **No RLS policies.**
- **No repositories or queries.** `DatabaseService` has no callers yet — it is
  infrastructure waiting for the first domain.

The seam exists now so the first domain is written against it, rather than
against `supabase-js` and then migrated once transactions turn out to matter.

---

## 6. Related documents

- [architecture.md](./architecture.md) — the system as a whole
- [cross-domain-orchestration.md](./cross-domain-orchestration.md) — transactions that span domains
- [local-development.md](./local-development.md) — running Postgres locally

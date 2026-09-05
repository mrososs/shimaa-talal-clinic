import {
  createTestDatabase,
  testDatabaseUrl,
  type ServerConfigService,
  type SqlExecutor,
  type TestDatabase,
} from '@clinic/server-core';

/**
 * A disposable clinic to run a suite inside.
 *
 * Every query in this domain is scoped by `clinic_id`, so tests need a real
 * tenant to scope to — and a second one, to prove that scoping actually holds.
 * Both are created with unique slugs and removed afterwards, so a suite leaves
 * the database as it found it and two suites cannot see each other's rows.
 */
export interface PatientsFixture {
  readonly db: TestDatabase;
  readonly clinicId: string;
  /** A second tenant, for asserting that a query cannot cross clinics. */
  readonly otherClinicId: string;
  /** A staff member id, for the `created_by` and `issued_by` columns. */
  readonly memberId: string;
  /** An auth user that is not linked to anything. */
  readonly authUserId: string;
  readonly otherAuthUserId: string;
}

export const REGION = 'EG' as const;

const SUITE_TAG = `test-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

/**
 * Two staff auth users exist in this project; the fixture borrows one so the
 * `NOT NULL` foreign key on `clinic_members.auth_user_id` is satisfied without
 * creating auth users, which is not this domain's business.
 *
 * Resolved by email rather than by a hardcoded uuid: an id belongs to one
 * environment, and a test that carries one only runs in that environment.
 */
const STAFF_EMAIL = 'reception@email.com';

export function describeWithDatabase(
  name: string,
  suite: (fixture: PatientsFixture) => void,
): void {
  const url = testDatabaseUrl();

  if (url === null) {
    describe.skip(`${name} (no MIGRATION_DATABASE_URL configured)`, () => {
      it('is skipped', () => undefined);
    });
    return;
  }

  describe(name, () => {
    const fixture = {} as {
      -readonly [K in keyof PatientsFixture]: PatientsFixture[K];
    };

    beforeAll(async () => {
      fixture.db = createTestDatabase(url);
      const sql = fixture.db.database;

      fixture.clinicId = await insertClinic(sql, `${SUITE_TAG}-a`);
      fixture.otherClinicId = await insertClinic(sql, `${SUITE_TAG}-b`);

      const staff = await sql.query<{ id: string }>(
        `select id from auth.users where email = $1 limit 1`,
        [STAFF_EMAIL],
      );
      if (staff.rows[0] === undefined) {
        throw new Error(
          `Expected an auth user ${STAFF_EMAIL} to exist for the fixture.`,
        );
      }
      fixture.authUserId = staff.rows[0].id;

      const other = await sql.query<{ id: string }>(
        `select id from auth.users where email <> $1 order by created_at limit 1`,
        [STAFF_EMAIL],
      );
      fixture.otherAuthUserId = other.rows[0]?.id ?? fixture.authUserId;

      const member = await sql.query<{ id: string }>(
        `insert into clinic.clinic_members
           (clinic_id, auth_user_id, role, display_name)
         values ($1, $2, 'reception', 'Fixture Reception')
         returning id`,
        [fixture.clinicId, fixture.authUserId],
      );
      fixture.memberId = member.rows[0].id;
    }, 60_000);

    afterAll(async () => {
      if (fixture.db === undefined) return;
      await removeClinics(fixture.db.database, [
        fixture.clinicId,
        fixture.otherClinicId,
      ]);
      await fixture.db.close();
    }, 60_000);

    suite(fixture as PatientsFixture);
  });
}

async function insertClinic(sql: SqlExecutor, slug: string): Promise<string> {
  const result = await sql.query<{ id: string }>(
    `insert into clinic.clinics (name, slug, timezone, default_country_code)
     values ($1, $2, 'Africa/Cairo', 'EG')
     returning id`,
    [`Fixture ${slug}`, slug],
  );
  return result.rows[0].id;
}

/**
 * Foreign keys here are RESTRICT rather than CASCADE, deliberately — a visit
 * history that outlives its patient is worse than a stale row — so teardown
 * removes rows in dependency order rather than relying on a cascade.
 */
async function removeClinics(
  sql: SqlExecutor,
  clinicIds: string[],
): Promise<void> {
  await sql.query(
    `delete from clinic.guardian_claim_codes
      where guardian_id in (select id from clinic.guardians where clinic_id = any($1))`,
    [clinicIds],
  );
  await sql.query(
    `delete from clinic.guardian_children
      where child_id in (select id from clinic.children where clinic_id = any($1))`,
    [clinicIds],
  );
  await sql.query(`delete from clinic.children where clinic_id = any($1)`, [
    clinicIds,
  ]);
  await sql.query(`delete from clinic.guardians where clinic_id = any($1)`, [
    clinicIds,
  ]);
  await sql.query(
    `delete from clinic.clinic_members where clinic_id = any($1)`,
    [clinicIds],
  );
  await sql.query(`delete from clinic.clinics where id = any($1)`, [clinicIds]);
}

/** A phone that is unique per call, so parallel tests cannot collide. */
let phoneCounter = 0;
export function uniquePhone(): string {
  phoneCounter += 1;
  const suffix = String(10_000_000 + phoneCounter).slice(-8);
  return `010${suffix}`;
}

/**
 * The slice of `ServerConfigService` this domain reads.
 *
 * Built by hand rather than by booting the configuration module: a suite needs
 * one value, and standing up Nest's config to get it would couple every domain
 * test to how the application boots.
 *
 * The cast lives here, once, rather than at each call site. Services depend on
 * the concrete `ServerConfigService` by design — the repo's rule is to inject
 * it and never `process.env` — so a stub cannot structurally satisfy it.
 */
export function testConfig(): ServerConfigService {
  const pepper = process.env['CLAIM_CODE_PEPPER'];
  if (pepper === undefined || pepper.length < 32) {
    throw new Error(
      'CLAIM_CODE_PEPPER must be set for the patients suite; see .env.example.',
    );
  }
  return {
    security: { claimCodePepper: pepper },
  } as unknown as ServerConfigService;
}

import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from '@clinic/server-core';
import { ClaimCodeService } from '@clinic/server-patients';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

/**
 * The parent identity endpoints, over real HTTP.
 *
 * These are the first routes a person actually touches, and the first place a
 * mistake would expose one family's records to another. So the shape of a happy
 * path matters less here than what each route refuses.
 */

const url = testDatabaseUrl();
const supabaseUrl = process.env['SUPABASE_URL'];
const secretKey = process.env['SUPABASE_SECRET_KEY'];
const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'];
const configured =
  url !== null &&
  supabaseUrl !== undefined &&
  secretKey !== undefined &&
  publishableKey !== undefined;

(configured ? describe : describe.skip)('parent identity (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let db: TestDatabase;
  let admin: SupabaseClient;
  let anon: SupabaseClient;

  const tag = `p3-${Date.now().toString(36)}`;
  const createdUserIds: string[] = [];
  const createdGuardianIds: string[] = [];
  let clinicId: string;
  let receptionMemberId: string;
  let phoneCounter = 0;

  /** The caller under test, and somebody else, for ownership checks. */
  let parent: { id: string; token: string };
  let other: { id: string; token: string };

  const phoneBase = String(Date.now() % 1_000_000).padStart(6, '0');
  const uniquePhone = () => {
    phoneCounter += 1;
    return `010${phoneBase}${String(phoneCounter).padStart(2, '0')}`;
  };

  /**
   * Two accounts for the whole suite, created once.
   *
   * Not one per test. Supabase rate limits sign-in, and a suite that mints
   * twenty sessions per run exhausts that in two runs — which makes it fail for
   * a reason that has nothing to do with the code under test. Each test instead
   * starts from a clean identity, because `beforeEach` removes whatever the
   * last one attached to these accounts.
   */
  async function createAccount(label: string): Promise<{
    id: string;
    token: string;
  }> {
    const email = `${tag}-${label}@example.test`;
    const password = randomBytes(24).toString('base64url');

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error) throw created.error;
    createdUserIds.push(created.data.user.id);

    const session = await anon.auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;
    return {
      id: created.data.user.id,
      token: session.data.session.access_token,
    };
  }

  async function call(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(options.token === undefined
          ? {}
          : { Authorization: `Bearer ${options.token}` }),
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }

  const data = (body: Record<string, unknown>): Record<string, unknown> =>
    body['data'] as Record<string, unknown>;
  const errorCode = (body: Record<string, unknown>): string =>
    (body['error'] as { code: string }).code;

  /** A guardian reception created, with no account attached. */
  async function receptionCreatedGuardian(phone: string): Promise<string> {
    const row = await db.database.query<{ id: string }>(
      `insert into clinic.guardians
         (clinic_id, full_name, phone_e164, created_by_member_id)
       values ($1, 'Reception Created', $2, $3)
       returning id`,
      [clinicId, `+20${phone.slice(1)}`, receptionMemberId],
    );
    createdGuardianIds.push(row.rows[0].id);
    return row.rows[0].id;
  }

  beforeAll(async () => {
    db = createTestDatabase(url as string);
    admin = createClient(supabaseUrl as string, secretKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anon = createClient(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const clinic = await db.database.query<{ id: string }>(
      `select id from clinic.clinics where slug = $1`,
      [process.env['CLINIC_SLUG']],
    );
    clinicId = clinic.rows[0].id;

    const member = await db.database.query<{ id: string }>(
      `select id from clinic.clinic_members
        where clinic_id = $1 and role = 'reception' limit 1`,
      [clinicId],
    );
    receptionMemberId = member.rows[0].id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1`;

    parent = await createAccount('parent');
    other = await createAccount('other');
  }, 120_000);

  /**
   * Return both accounts to "signed in, never onboarded".
   *
   * Cheaper and more reliable than a fresh account per test, and it makes each
   * test's starting point explicit rather than inherited.
   */
  beforeEach(async () => {
    const owners = [parent.id, other.id];
    await db.database.query(
      `delete from clinic.guardian_claim_codes
        where guardian_id in (
          select id from clinic.guardians
           where auth_user_id = any($1) or id = any($2))`,
      [owners, createdGuardianIds],
    );
    // The links go first, and they name the children to remove. Sweeping every
    // orphaned child in the clinic instead would be shorter and wrong: this
    // clinic is shared with other suites, and one of them keeps a deliberately
    // unlinked child to prove a parent cannot book for somebody else's.
    const links = await db.database.query<{ child_id: string }>(
      `delete from clinic.guardian_children
        where guardian_id in (
          select id from clinic.guardians
           where auth_user_id = any($1) or id = any($2))
        returning child_id`,
      [owners, createdGuardianIds],
    );
    await db.database.query(`delete from clinic.children where id = any($1)`, [
      links.rows.map((row) => row.child_id),
    ]);
    await db.database.query(
      `delete from clinic.guardians
        where auth_user_id = any($1) or id = any($2)`,
      [owners, createdGuardianIds],
    );
    createdGuardianIds.length = 0;
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (db !== undefined) {
      await db.database.query(
        `delete from clinic.guardian_claim_codes
          where guardian_id in (
            select id from clinic.guardians
             where id = any($1) or auth_user_id = any($2))`,
        [createdGuardianIds, createdUserIds],
      );
      // Same reason as the per-test cleanup: the links name the children to
      // remove, so this cannot reach into another suite's fixture.
      const links = await db.database.query<{ child_id: string }>(
        `delete from clinic.guardian_children
          where guardian_id in (
            select id from clinic.guardians
             where id = any($1) or auth_user_id = any($2))
          returning child_id`,
        [createdGuardianIds, createdUserIds],
      );
      await db.database.query(
        `delete from clinic.children where id = any($1)`,
        [links.rows.map((row) => row.child_id)],
      );
      await db.database.query(
        `delete from clinic.guardians where id = any($1) or auth_user_id = any($2)`,
        [createdGuardianIds, createdUserIds],
      );
      await db.close();
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 120_000);

  describe('GET /me', () => {
    it('requires a token', async () => {
      const response = await call('GET', '/me');
      expect(response.status).toBe(401);
    });

    it('reports a fresh account as having no guardian, and still names the clinic', async () => {
      // The onboarding state. The clinic is present because the app needs its
      // phone region before a guardian exists to carry one.
      const token = parent.token;
      const response = await call('GET', '/me', { token });

      expect(response.status).toBe(200);
      expect(data(response.body)['guardian']).toBeNull();
      expect(data(response.body)['children']).toEqual([]);
      expect(data(response.body)['clinic']).toMatchObject({
        slug: process.env['CLINIC_SLUG'],
        defaultCountryCode: 'EG',
      });
    });

    it('returns the guardian once onboarding has happened', async () => {
      const token = parent.token;
      const phone = uniquePhone();

      const created = await call('POST', '/me/guardian', {
        token,
        body: { fullName: 'Umm Leen', phone, relationship: 'mother' },
      });
      expect(created.status).toBe(201);

      const me = await call('GET', '/me', { token });
      expect(data(me.body)['guardian']).toMatchObject({
        fullName: 'Umm Leen',
        phoneE164: `+20${phone.slice(1)}`,
        hasAccount: true,
      });
    });
  });

  describe('POST /me/guardian', () => {
    it('normalises a locally typed phone', async () => {
      const token = parent.token;
      const phone = uniquePhone();

      const response = await call('POST', '/me/guardian', {
        token,
        body: {
          fullName: 'Local Format',
          phone: `${phone.slice(0, 4)} ${phone.slice(4, 8)} ${phone.slice(8)}`,
        },
      });

      expect(data(response.body)['phoneE164']).toBe(`+20${phone.slice(1)}`);
    });

    it('refuses a second guardian for the same account', async () => {
      const token = parent.token;
      await call('POST', '/me/guardian', {
        token,
        body: { fullName: 'First', phone: uniquePhone() },
      });

      const again = await call('POST', '/me/guardian', {
        token,
        body: { fullName: 'Second', phone: uniquePhone() },
      });
      expect(again.status).toBe(409);
      expect(errorCode(again.body)).toBe('auth_user_already_linked');
    });

    it('reports a phone the clinic already knows, rather than duplicating the family', async () => {
      const phone = uniquePhone();
      await receptionCreatedGuardian(phone);

      const token = parent.token;
      const response = await call('POST', '/me/guardian', {
        token,
        body: { fullName: 'Same Number', phone },
      });

      // The client's next move is to claim, not to create.
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('guardian_phone_taken');
    });

    it('rejects a phone it cannot read', async () => {
      const token = parent.token;
      const response = await call('POST', '/me/guardian', {
        token,
        body: { fullName: 'Bad Phone', phone: 'abcdefgh' },
      });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('invalid_phone');
    });

    it('rejects an undeclared field rather than ignoring it', async () => {
      const token = parent.token;
      const response = await call('POST', '/me/guardian', {
        token,
        body: {
          fullName: 'Sneaky',
          phone: uniquePhone(),
          clinicId: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(response.status).toBe(400);
    });
  });

  describe('claiming', () => {
    it('reports a match for a family reception entered', async () => {
      const phone = uniquePhone();
      await receptionCreatedGuardian(phone);
      const token = parent.token;

      const response = await call('POST', '/me/guardian/claim-request', {
        token,
        body: { phone },
      });
      expect(data(response.body)).toEqual({ matchFound: true });
    });

    it.each([
      ['an unknown number', false],
      ['a number already linked to an account', true],
    ])('reports no match for %s', async (_label, linkFirst) => {
      // The two must be indistinguishable, or the endpoint becomes a way to
      // discover who is registered at the clinic.
      const phone = uniquePhone();
      const token = parent.token;

      if (linkFirst) {
        await call('POST', '/me/guardian', {
          token,
          body: { fullName: 'Registered', phone },
        });
      }

      const prober = other.token;
      const response = await call('POST', '/me/guardian/claim-request', {
        token: prober,
        body: { phone },
      });
      expect(data(response.body)).toEqual({ matchFound: false });
    });

    it('links the account when the code is right', async () => {
      const phone = uniquePhone();
      const guardianId = await receptionCreatedGuardian(phone);
      const code = await issueCode(guardianId);
      const token = parent.token;

      const response = await call('POST', '/me/guardian/claim', {
        token,
        body: { phone, code },
      });

      expect(response.status).toBe(200);
      expect(data(response.body)).toMatchObject({
        id: guardianId,
        hasAccount: true,
      });

      const me = await call('GET', '/me', { token });
      expect(data(me.body)['guardian']).toMatchObject({ id: guardianId });
    });

    it('refuses a wrong code', async () => {
      const phone = uniquePhone();
      const guardianId = await receptionCreatedGuardian(phone);
      const issued = await issueCode(guardianId);
      const token = parent.token;

      const response = await call('POST', '/me/guardian/claim', {
        token,
        body: { phone, code: issued === '000000' ? '111111' : '000000' },
      });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('claim_code_invalid');
    });

    it('fails identically for an unknown number as for a wrong code', async () => {
      // Never confirms that a phone belongs to somebody.
      const token = parent.token;
      const response = await call('POST', '/me/guardian/claim', {
        token,
        body: { phone: uniquePhone(), code: '123456' },
      });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('claim_code_invalid');
    });

    it('rejects a malformed code before it reaches the domain', async () => {
      const token = parent.token;
      const response = await call('POST', '/me/guardian/claim', {
        token,
        body: { phone: uniquePhone(), code: '12' },
      });
      expect(response.status).toBe(400);
    });
  });

  describe('children', () => {
    it('needs a guardian, not merely an account', async () => {
      const token = parent.token;
      const response = await call('GET', '/me/children', { token });
      expect(response.status).toBe(403);
    });

    it('creates a child and lists it', async () => {
      const token = parent.token;
      await call('POST', '/me/guardian', {
        token,
        body: { fullName: 'Parent', phone: uniquePhone() },
      });

      const created = await call('POST', '/me/children', {
        token,
        body: {
          fullName: 'Leen',
          dateOfBirth: '2021-06-12',
          sex: 'female',
          relationship: 'mother',
        },
      });
      expect(created.status).toBe(201);
      expect(data(created.body)).toMatchObject({
        fullName: 'Leen',
        dateOfBirth: '2021-06-12',
        relationship: 'mother',
      });

      const listed = await call('GET', '/me/children', { token });
      expect(data(listed.body) as unknown as unknown[]).toHaveLength(1);
    });

    it('updates only its own child', async () => {
      const mine = parent.token;
      await call('POST', '/me/guardian', {
        token: mine,
        body: { fullName: 'Owner', phone: uniquePhone() },
      });
      const child = await call('POST', '/me/children', {
        token: mine,
        body: { fullName: 'Mine' },
      });
      const childId = data(child.body)['id'] as string;

      const updated = await call('PATCH', `/me/children/${childId}`, {
        token: mine,
        body: { fullName: 'Renamed' },
      });
      expect(data(updated.body)['fullName']).toBe('Renamed');

      // Another guardian sees "no such child", not "not yours" — the difference
      // between those answers is information about somebody else's patient.
      const stranger = other.token;
      await call('POST', '/me/guardian', {
        token: stranger,
        body: { fullName: 'Stranger', phone: uniquePhone() },
      });
      const denied = await call('PATCH', `/me/children/${childId}`, {
        token: stranger,
        body: { fullName: 'Hijacked' },
      });
      expect(denied.status).toBe(404);
      expect(errorCode(denied.body)).toBe('child_not_found');
    });

    it('rejects a childId that is not a uuid', async () => {
      const token = parent.token;
      await call('POST', '/me/guardian', {
        token,
        body: { fullName: 'Bad Id', phone: uniquePhone() },
      });
      const response = await call('PATCH', '/me/children/not-a-uuid', {
        token,
        body: { fullName: 'x' },
      });
      expect(response.status).toBe(400);
    });
  });

  /**
   * Issues a code the way reception will once the staff endpoint exists.
   *
   * Pulled from the running application's container rather than constructed
   * here, so the test uses the same instance — and the same pepper — the API
   * does. A hand-built one could disagree and the suite would still pass.
   */
  async function issueCode(guardianId: string): Promise<string> {
    const service = app.get(ClaimCodeService, { strict: false });
    const issued = await service.issue(clinicId, guardianId, receptionMemberId);
    return issued.code;
  }
});

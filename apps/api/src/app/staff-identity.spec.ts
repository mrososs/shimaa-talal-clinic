import { createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from '@clinic/server-core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

/**
 * Reception's identity endpoints, over real HTTP.
 *
 * Two properties carry the weight here. One clinic must not be able to reach
 * another's families — proved by a second clinic with its own staff, not by
 * reading the queries. And a doctor must not pick up reception's write access
 * simply because both are staff.
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

(configured ? describe : describe.skip)('staff identity (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let db: TestDatabase;
  let admin: SupabaseClient;
  let anon: SupabaseClient;

  const tag = `p4-${Date.now().toString(36)}`;
  const createdUserIds: string[] = [];
  let clinicId: string;
  let otherClinicId: string;

  /**
   * One session per persona, created once.
   *
   * Supabase rate limits sign-in, so a suite that mints a session per test
   * stops being runnable twice in a row for reasons unrelated to the code.
   */
  const tokens = {} as Record<
    'reception' | 'doctor' | 'suspended' | 'foreign' | 'parent',
    string
  >;

  let phoneCounter = 0;
  const phoneBase = String(Date.now() % 1_000_000).padStart(6, '0');
  const uniquePhone = () => {
    phoneCounter += 1;
    return `010${phoneBase}${String(phoneCounter).padStart(2, '0')}`;
  };

  async function account(label: string): Promise<string> {
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
    tokens[label as keyof typeof tokens] = session.data.session.access_token;
    return created.data.user.id;
  }

  async function member(
    authUserId: string,
    role: string,
    clinic: string,
    status = 'active',
  ): Promise<void> {
    await db.database.query(
      `insert into clinic.clinic_members
         (clinic_id, auth_user_id, role, display_name, status)
       values ($1, $2, $3, $4, $5)`,
      [clinic, authUserId, role, `${tag} ${role}`, status],
    );
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

  /** A guardian belonging to whichever clinic is named. */
  async function seedGuardian(
    clinic: string,
    name = 'Seeded Family',
  ): Promise<{ id: string; phone: string }> {
    const phone = uniquePhone();
    const row = await db.database.query<{ id: string }>(
      `insert into clinic.guardians (clinic_id, full_name, phone_e164)
       values ($1, $2, $3) returning id`,
      [clinic, name, `+20${phone.slice(1)}`],
    );
    return { id: row.rows[0].id, phone };
  }

  beforeAll(async () => {
    db = createTestDatabase(url as string);
    admin = createClient(supabaseUrl as string, secretKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    anon = createClient(supabaseUrl as string, publishableKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const pilot = await db.database.query<{ id: string }>(
      `select id from clinic.clinics where slug = $1`,
      [process.env['CLINIC_SLUG']],
    );
    clinicId = pilot.rows[0].id;

    const other = await db.database.query<{ id: string }>(
      `insert into clinic.clinics (name, slug) values ($1, $2) returning id`,
      [`Other ${tag}`, tag],
    );
    otherClinicId = other.rows[0].id;

    // Throwaway staff, so the pilot's real doctor and reception accounts are
    // never mutated by a test run.
    await member(await account('reception'), 'reception', clinicId);
    await member(await account('doctor'), 'doctor', clinicId);
    await member(await account('suspended'), 'reception', clinicId, 'suspended');
    await member(await account('foreign'), 'reception', otherClinicId);
    await account('parent');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1`;
  }, 120_000);

  /**
   * Remove exactly what this run created, and nothing else.
   *
   * Scoping the delete to the pilot clinic would be much shorter and would be
   * wrong: it would wipe every real family the day reception has entered one.
   * Every guardian this suite creates — seeded directly or through the API —
   * carries this run's phone prefix, so that prefix is the handle.
   */
  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (db !== undefined) {
      const mine = await db.database.query<{ id: string }>(
        `select id from clinic.guardians
          where clinic_id = any($1) and phone_e164 like $2`,
        [[clinicId, otherClinicId], `+2010${phoneBase}%`],
      );
      const guardianIds = mine.rows.map((row) => row.id);

      const links = await db.database.query<{ child_id: string }>(
        `delete from clinic.guardian_children
          where guardian_id = any($1) returning child_id`,
        [guardianIds],
      );
      await db.database.query(
        `delete from clinic.guardian_claim_codes where guardian_id = any($1)`,
        [guardianIds],
      );
      await db.database.query(`delete from clinic.children where id = any($1)`, [
        links.rows.map((row) => row.child_id),
      ]);
      await db.database.query(`delete from clinic.guardians where id = any($1)`, [
        guardianIds,
      ]);
      await db.database.query(
        `delete from clinic.clinic_members where auth_user_id = any($1)`,
        [createdUserIds],
      );
      await db.database.query(`delete from clinic.clinics where id = $1`, [
        otherClinicId,
      ]);
      await db.close();
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 120_000);

  describe('search', () => {
    it('finds a guardian from a locally typed phone', async () => {
      // The receptionist types what is on the caller ID, not what the database
      // stores.
      const seeded = await seedGuardian(clinicId, 'Local Lookup');

      const response = await call(
        'GET',
        `/clinic/guardians?phone=${seeded.phone}`,
        { token: tokens.reception },
      );

      expect(response.status).toBe(200);
      expect(data(response.body)['items']).toHaveLength(1);
      expect(
        (data(response.body)['items'] as Record<string, unknown>[])[0],
      ).toMatchObject({ id: seeded.id, phoneE164: `+20${seeded.phone.slice(1)}` });
    });

    it('finds the same guardian from the international form', async () => {
      const seeded = await seedGuardian(clinicId, 'International Lookup');
      const e164 = `+20${seeded.phone.slice(1)}`;

      const response = await call(
        'GET',
        `/clinic/guardians?phone=${encodeURIComponent(e164)}`,
        { token: tokens.reception },
      );
      expect(data(response.body)['items']).toHaveLength(1);
    });

    it('finds by name fragment', async () => {
      const marker = `Zq${Date.now().toString(36)}`;
      await seedGuardian(clinicId, `${marker} Family`);

      const response = await call('GET', `/clinic/guardians?q=${marker}`, {
        token: tokens.reception,
      });
      expect(data(response.body)['items']).toHaveLength(1);
    });

    it('returns an empty page for an unknown number', async () => {
      const response = await call(
        'GET',
        `/clinic/guardians?phone=${uniquePhone()}`,
        { token: tokens.reception },
      );
      expect(response.status).toBe(200);
      expect(data(response.body)['items']).toEqual([]);
      expect(data(response.body)['meta']).toMatchObject({ total: 0 });
    });

    it('rejects an undeclared query parameter, including clinicId', async () => {
      // forbidNonWhitelisted is what makes tenant injection a 400 rather than
      // something the controller has to remember to ignore.
      const response = await call(
        'GET',
        `/clinic/guardians?q=anything&clinicId=${otherClinicId}`,
        { token: tokens.reception },
      );
      expect(response.status).toBe(400);
    });
  });

  describe('create guardian', () => {
    it('registers a family with no account attached', async () => {
      const phone = uniquePhone();
      const response = await call('POST', '/clinic/guardians', {
        token: tokens.reception,
        body: { fullName: 'Abu Mariam', phone, relationship: 'father' },
      });

      expect(response.status).toBe(201);
      expect(data(response.body)).toMatchObject({
        fullName: 'Abu Mariam',
        phoneE164: `+20${phone.slice(1)}`,
        // The whole point of the reception path: bookable without an app.
        hasAccount: false,
      });
      // Server-owned internals never appear on the wire.
      expect(data(response.body)).not.toHaveProperty('authUserId');
    });

    it('offers the existing family instead of a duplicate', async () => {
      const seeded = await seedGuardian(clinicId, 'Already Here');

      const response = await call('POST', '/clinic/guardians', {
        token: tokens.reception,
        body: { fullName: 'Same Number', phone: seeded.phone },
      });

      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('guardian_phone_taken');
      // So the screen can open that family rather than nudging a receptionist
      // into creating a second record for the same person.
      expect(
        (response.body['error'] as { details?: { guardian?: { id: string } } })
          .details?.guardian?.id,
      ).toBe(seeded.id);
    });

    it('rejects a phone it cannot read', async () => {
      const response = await call('POST', '/clinic/guardians', {
        token: tokens.reception,
        body: { fullName: 'Bad Phone', phone: 'not-a-number' },
      });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('invalid_phone');
    });

    it('rejects a clinicId in the body', async () => {
      const response = await call('POST', '/clinic/guardians', {
        token: tokens.reception,
        body: {
          fullName: 'Injected',
          phone: uniquePhone(),
          clinicId: otherClinicId,
        },
      });
      expect(response.status).toBe(400);
    });
  });

  describe('guardian detail', () => {
    it('returns the family and its children', async () => {
      const seeded = await seedGuardian(clinicId, 'Detail Family');
      await call('POST', `/clinic/guardians/${seeded.id}/children`, {
        token: tokens.reception,
        body: { fullName: 'Leen', relationship: 'mother', isPrimary: true },
      });

      const response = await call('GET', `/clinic/guardians/${seeded.id}`, {
        token: tokens.reception,
      });

      expect(response.status).toBe(200);
      expect(data(response.body)['guardian']).toMatchObject({ id: seeded.id });
      expect(data(response.body)['children']).toHaveLength(1);
    });

    it('is 404 for a guardian that does not exist', async () => {
      const response = await call(
        'GET',
        '/clinic/guardians/00000000-0000-0000-0000-000000000000',
        { token: tokens.reception },
      );
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('guardian_not_found');
    });

    it('rejects a guardianId that is not a uuid', async () => {
      const response = await call('GET', '/clinic/guardians/nope', {
        token: tokens.reception,
      });
      expect(response.status).toBe(400);
    });
  });

  describe('children', () => {
    it('creates a child and links it to the family', async () => {
      const seeded = await seedGuardian(clinicId, 'Child Family');

      const created = await call(
        'POST',
        `/clinic/guardians/${seeded.id}/children`,
        {
          token: tokens.reception,
          body: {
            fullName: 'Yusuf',
            dateOfBirth: '2024-03-01',
            sex: 'male',
            relationship: 'father',
          },
        },
      );

      expect(created.status).toBe(201);
      expect(data(created.body)).toMatchObject({
        fullName: 'Yusuf',
        dateOfBirth: '2024-03-01',
        relationship: 'father',
      });
    });

    it('lets a second guardian be linked to the same child', async () => {
      // The reason guardian_children exists rather than children.guardian_id.
      const mother = await seedGuardian(clinicId, 'Mother');
      const father = await seedGuardian(clinicId, 'Father');
      const child = await call(
        'POST',
        `/clinic/guardians/${mother.id}/children`,
        {
          token: tokens.reception,
          body: { fullName: 'Shared', relationship: 'mother', isPrimary: true },
        },
      );
      const childId = data(child.body)['id'] as string;

      await db.database.query(
        `insert into clinic.guardian_children (guardian_id, child_id, relationship)
         values ($1, $2, 'father')`,
        [father.id, childId],
      );

      const detail = await call('GET', `/clinic/guardians/${father.id}`, {
        token: tokens.reception,
      });
      expect(data(detail.body)['children']).toHaveLength(1);
    });

    it('refuses a child under a guardian from another clinic', async () => {
      const foreign = await seedGuardian(otherClinicId, 'Foreign Family');

      const response = await call(
        'POST',
        `/clinic/guardians/${foreign.id}/children`,
        { token: tokens.reception, body: { fullName: 'Should Not Exist' } },
      );
      expect(response.status).toBe(404);
    });

    it('updates identity fields only', async () => {
      const seeded = await seedGuardian(clinicId, 'Update Family');
      const child = await call(
        'POST',
        `/clinic/guardians/${seeded.id}/children`,
        { token: tokens.reception, body: { fullName: 'Before' } },
      );
      const childId = data(child.body)['id'] as string;

      const updated = await call('PATCH', `/clinic/children/${childId}`, {
        token: tokens.reception,
        body: { fullName: 'After', dateOfBirth: '2020-01-15' },
      });
      expect(data(updated.body)).toMatchObject({
        fullName: 'After',
        dateOfBirth: '2020-01-15',
      });

      // Nothing clinical is accepted here.
      const rejected = await call('PATCH', `/clinic/children/${childId}`, {
        token: tokens.reception,
        body: { diagnosis: 'anything' },
      });
      expect(rejected.status).toBe(400);
    });
  });

  describe('update guardian', () => {
    it('applies a valid change', async () => {
      const seeded = await seedGuardian(clinicId, 'Rename Me');
      const response = await call('PATCH', `/clinic/guardians/${seeded.id}`, {
        token: tokens.reception,
        body: { fullName: 'Renamed' },
      });
      expect(data(response.body)['fullName']).toBe('Renamed');
    });

    it('rejects a name that is too short to be one', async () => {
      const seeded = await seedGuardian(clinicId, 'Validate Me');
      const response = await call('PATCH', `/clinic/guardians/${seeded.id}`, {
        token: tokens.reception,
        body: { fullName: 'x' },
      });
      expect(response.status).toBe(400);
    });

    it('reports a collision when moving onto an existing number', async () => {
      const holder = await seedGuardian(clinicId, 'Holder');
      const mover = await seedGuardian(clinicId, 'Mover');

      const response = await call('PATCH', `/clinic/guardians/${mover.id}`, {
        token: tokens.reception,
        body: { phone: holder.phone },
      });
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('guardian_phone_taken');
    });
  });

  describe('claim code', () => {
    it('returns the plaintext once and stores only a keyed digest', async () => {
      const seeded = await seedGuardian(clinicId, 'Claimable');

      const response = await call(
        'POST',
        `/clinic/guardians/${seeded.id}/claim-code`,
        { token: tokens.reception },
      );

      expect(response.status).toBe(201);
      const code = data(response.body)['code'] as string;
      expect(code).toMatch(/^\d{6}$/);
      expect(data(response.body)['expiresAt']).toEqual(expect.any(String));

      const stored = await db.database.query<{ code_hash: string }>(
        `select code_hash from clinic.guardian_claim_codes where guardian_id = $1`,
        [seeded.id],
      );
      // The row holds an HMAC under the server's pepper — not the code, and not
      // anything a stolen table could reverse.
      expect(stored.rows[0].code_hash).not.toContain(code);
      expect(stored.rows[0].code_hash).toBe(
        createHmac('sha256', process.env['CLAIM_CODE_PEPPER'] as string)
          .update(code)
          .digest('hex'),
      );
    });

    it('refuses a guardian that already has an account', async () => {
      const seeded = await seedGuardian(clinicId, 'Already Claimed');
      await db.database.query(
        `update clinic.guardians
            set auth_user_id = $2, claimed_at = now(), claimed_via = 'self_signup'
          where id = $1`,
        [seeded.id, createdUserIds[createdUserIds.length - 1]],
      );

      const response = await call(
        'POST',
        `/clinic/guardians/${seeded.id}/claim-code`,
        { token: tokens.reception },
      );
      expect(response.status).toBe(409);
      expect(errorCode(response.body)).toBe('guardian_already_claimed');

      await db.database.query(
        `update clinic.guardians
            set auth_user_id = null, claimed_at = null, claimed_via = null
          where id = $1`,
        [seeded.id],
      );
    });

    it('refuses a guardian at another clinic', async () => {
      const foreign = await seedGuardian(otherClinicId, 'Foreign Claim');
      const response = await call(
        'POST',
        `/clinic/guardians/${foreign.id}/claim-code`,
        { token: tokens.reception },
      );
      expect(response.status).toBe(404);
    });
  });

  describe('authorisation', () => {
    it('lets a doctor read but not write', async () => {
      // A doctor legitimately looks up the family of the child in front of
      // them. Registering families is reception's job, and being staff is not
      // the same as being reception.
      const seeded = await seedGuardian(clinicId, 'Doctor Reads');

      const read = await call('GET', `/clinic/guardians/${seeded.id}`, {
        token: tokens.doctor,
      });
      expect(read.status).toBe(200);

      const search = await call('GET', '/clinic/guardians?q=Doctor', {
        token: tokens.doctor,
      });
      expect(search.status).toBe(200);

      for (const [method, path, body] of [
        ['POST', '/clinic/guardians', { fullName: 'No', phone: uniquePhone() }],
        ['PATCH', `/clinic/guardians/${seeded.id}`, { fullName: 'No' }],
        ['POST', `/clinic/guardians/${seeded.id}/children`, { fullName: 'No' }],
        ['POST', `/clinic/guardians/${seeded.id}/claim-code`, undefined],
      ] as const) {
        const response = await call(method, path, {
          token: tokens.doctor,
          body,
        });
        expect(response.status).toBe(403);
      }
    });

    it('refuses a parent every staff route', async () => {
      const seeded = await seedGuardian(clinicId, 'Parent Denied');
      for (const [method, path] of [
        ['GET', '/clinic/guardians'],
        ['GET', `/clinic/guardians/${seeded.id}`],
        ['POST', '/clinic/guardians'],
        ['PATCH', `/clinic/guardians/${seeded.id}`],
        ['POST', `/clinic/guardians/${seeded.id}/children`],
        ['POST', `/clinic/guardians/${seeded.id}/claim-code`],
      ] as const) {
        const response = await call(method, path, { token: tokens.parent });
        expect(response.status).toBe(403);
      }
    });

    it('refuses suspended staff', async () => {
      const response = await call('GET', '/clinic/guardians?q=any', {
        token: tokens.suspended,
      });
      expect(response.status).toBe(403);
      expect(
        (response.body['error'] as { message: string }).message,
      ).toContain('suspended');
    });

    it('refuses a request with no token', async () => {
      const response = await call('GET', '/clinic/guardians?q=any');
      expect(response.status).toBe(401);
    });
  });

  describe('tenant isolation', () => {
    it('cannot see another clinic in a search', async () => {
      const foreign = await seedGuardian(otherClinicId, 'Invisible');

      const byPhone = await call(
        'GET',
        `/clinic/guardians?phone=${foreign.phone}`,
        { token: tokens.reception },
      );
      expect(data(byPhone.body)['items']).toEqual([]);

      const byName = await call('GET', '/clinic/guardians?q=Invisible', {
        token: tokens.reception,
      });
      expect(data(byName.body)['items']).toEqual([]);
    });

    it.each([
      ['fetch', 'GET', (id: string) => `/clinic/guardians/${id}`, undefined],
      [
        'update',
        'PATCH',
        (id: string) => `/clinic/guardians/${id}`,
        { fullName: 'Hijacked' },
      ],
      [
        'add a child to',
        'POST',
        (id: string) => `/clinic/guardians/${id}/children`,
        { fullName: 'Hijacked' },
      ],
      [
        'issue a claim code for',
        'POST',
        (id: string) => `/clinic/guardians/${id}/claim-code`,
        undefined,
      ],
    ])('cannot %s another clinic’s guardian', async (_label, method, path, body) => {
      // 404, not 403: confirming the row exists elsewhere is itself a leak.
      const foreign = await seedGuardian(otherClinicId, 'Cross Tenant');
      const response = await call(method, path(foreign.id), {
        token: tokens.reception,
        body,
      });
      expect(response.status).toBe(404);
    });

    it('scopes a foreign clinic’s reception to their own families', async () => {
      const mine = await seedGuardian(clinicId, 'Mine Only');
      const theirs = await seedGuardian(otherClinicId, 'Theirs Only');

      const denied = await call('GET', `/clinic/guardians/${mine.id}`, {
        token: tokens.foreign,
      });
      expect(denied.status).toBe(404);

      const allowed = await call('GET', `/clinic/guardians/${theirs.id}`, {
        token: tokens.foreign,
      });
      expect(allowed.status).toBe(200);
    });
  });
});

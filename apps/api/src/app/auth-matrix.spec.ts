import { randomBytes } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { UserRole } from '@clinic/contracts';
import {
  CurrentGuardian,
  CurrentMember,
  CurrentUser,
  Public,
  Roles,
  createTestDatabase,
  testDatabaseUrl,
  type AuthenticatedUser,
  type ClinicMemberContext,
  type GuardianContext,
  type TestDatabase,
} from '@clinic/server-core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

/**
 * The authentication and authorisation stack, over real HTTP.
 *
 * Unit tests cover each guard's logic. This asserts the thing none of them can:
 * that the pieces are actually wired together in the running application, in
 * the right order, and that a token issued by Supabase resolves all the way
 * through to a clinic identity.
 *
 * The probe controller below exists only in this file. It is not a production
 * endpoint and grants nothing — it reports what the guards already decided, so
 * the decisions can be observed instead of inferred.
 */
@Controller({ path: 'probe', version: '1' })
class AuthProbeController {
  @Public()
  @Get('open')
  open(): { open: true } {
    return { open: true };
  }

  /** Authenticated, but requiring no role — the onboarding state. */
  @Get('authenticated')
  authenticated(@CurrentUser() user: AuthenticatedUser): {
    userId: string;
    roles: string[];
  } {
    return { userId: user.id, roles: user.roles };
  }

  @Roles(UserRole.Guardian)
  @Get('parent')
  parent(@CurrentGuardian() guardian: GuardianContext): GuardianContext {
    return guardian;
  }

  @Roles(UserRole.Doctor)
  @Get('doctor')
  doctor(@CurrentMember() member: ClinicMemberContext): ClinicMemberContext {
    return member;
  }

  @Roles(UserRole.Reception)
  @Get('reception')
  reception(@CurrentMember() member: ClinicMemberContext): ClinicMemberContext {
    return member;
  }

  @Roles(UserRole.Doctor, UserRole.Reception)
  @Get('staff')
  staff(@CurrentMember() member: ClinicMemberContext): { clinicId: string } {
    // Returns the clinic the *token* resolved to. A caller may put whatever it
    // likes in the query string; nothing here reads it.
    return { clinicId: member.clinicId };
  }
}

const url = testDatabaseUrl();
const supabaseUrl = process.env['SUPABASE_URL'];
const secretKey = process.env['SUPABASE_SECRET_KEY'];
const publishableKey = process.env['SUPABASE_PUBLISHABLE_KEY'];
const configured =
  url !== null &&
  supabaseUrl !== undefined &&
  secretKey !== undefined &&
  publishableKey !== undefined;

const suite = configured ? describe : describe.skip;

suite('auth matrix (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let db: TestDatabase;
  let admin: SupabaseClient;
  let anon: SupabaseClient;

  const tag = `authmx-${Date.now().toString(36)}`;
  const createdUserIds: string[] = [];
  let otherClinicId: string;
  let parentGuardianId: string;

  const tokens: Record<string, string> = {};

  /** A throwaway account. Password is generated and never leaves this process. */
  async function createUser(label: string): Promise<string> {
    const email = `${tag}-${label}@example.test`;
    const created = await admin.auth.admin.createUser({
      email,
      password: randomBytes(24).toString('base64url'),
      email_confirm: true,
    });
    if (created.error) throw created.error;
    const id = created.data.user.id;
    createdUserIds.push(id);
    tokens[label] = await mintToken(email);
    return id;
  }

  /**
   * A session for an existing account, without its password.
   *
   * `generateLink` is an admin operation that returns the link rather than
   * sending it, so the real staff accounts can be exercised without anyone
   * needing to know or change their credentials.
   */
  async function mintToken(email: string): Promise<string> {
    const link = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (link.error) throw link.error;

    const verified = await anon.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'magiclink',
    });
    if (verified.error) throw verified.error;

    const token = verified.data.session?.access_token;
    if (token === undefined) throw new Error(`No session issued for ${email}.`);
    return token;
  }

  async function get(
    path: string,
    token?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${base}${path}`, {
      headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
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
      `select id from clinic.clinics where slug = 'shimaa-talal'`,
    );
    const pilotClinicId = pilot.rows[0].id;

    const other = await db.database.query<{ id: string }>(
      `insert into clinic.clinics (name, slug) values ($1, $2) returning id`,
      [`Other ${tag}`, tag],
    );
    otherClinicId = other.rows[0].id;

    // The real staff, linked by the bootstrap script.
    tokens['doctor'] = await mintToken('doctor@email.com');
    tokens['reception'] = await mintToken('reception@email.com');

    // A signed-in user who has not onboarded.
    await createUser('fresh');

    // A parent with a linked guardian.
    const parentUserId = await createUser('parent');
    const guardian = await db.database.query<{ id: string }>(
      `insert into clinic.guardians
         (clinic_id, full_name, phone_e164, auth_user_id, claimed_at, claimed_via)
       values ($1, 'Matrix Parent', $2, $3, now(), 'self_signup')
       returning id`,
      [pilotClinicId, `+2010${Date.now().toString().slice(-8)}`, parentUserId],
    );
    parentGuardianId = guardian.rows[0].id;

    // Staff whose account was suspended.
    const suspendedUserId = await createUser('suspended');
    await db.database.query(
      `insert into clinic.clinic_members
         (clinic_id, auth_user_id, role, display_name, status)
       values ($1, $2, 'reception', 'Suspended', 'suspended')`,
      [pilotClinicId, suspendedUserId],
    );

    // Active staff, but at a different clinic.
    const foreignUserId = await createUser('foreign');
    await db.database.query(
      `insert into clinic.clinic_members
         (clinic_id, auth_user_id, role, display_name)
       values ($1, $2, 'reception', 'Foreign Reception')`,
      [otherClinicId, foreignUserId],
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api/v1`;
  }, 120_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (db !== undefined) {
      await db.database.query(`delete from clinic.guardians where id = $1`, [
        parentGuardianId,
      ]);
      await db.database.query(
        `delete from clinic.clinic_members where auth_user_id = any($1) or clinic_id = $2`,
        [createdUserIds, otherClinicId],
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

  it('1. /health stays public and flat', async () => {
    const response = await get('/health');
    expect(response.status).toBe(200);
    // No envelope: probes read this.
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('2. a request with no token is refused', async () => {
    const response = await get('/probe/authenticated');
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'unauthorized' },
    });
  });

  it('2b. a probe route marked public needs no token', async () => {
    const response = await get('/probe/open');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { open: true } });
  });

  it('3. a fresh account is authenticated but holds no roles', async () => {
    // The onboarding state: signed in, not yet a guardian, not staff.
    const response = await get('/probe/authenticated', tokens['fresh']);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { roles: [] },
    });

    // And it cannot reach a route that requires being a guardian.
    const parent = await get('/probe/parent', tokens['fresh']);
    expect(parent.status).toBe(403);
  });

  it('4. a linked guardian resolves to its guardian and clinic', async () => {
    const response = await get('/probe/parent', tokens['parent']);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: parentGuardianId },
    });
  });

  it('5. the doctor account resolves the doctor role', async () => {
    const response = await get('/probe/doctor', tokens['doctor']);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { role: 'doctor', status: 'active' },
    });
  });

  it('6. the reception account resolves the reception role', async () => {
    const response = await get('/probe/reception', tokens['reception']);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { role: 'reception', status: 'active' },
    });
  });

  it('7. a parent cannot reach a staff route', async () => {
    const response = await get('/probe/reception', tokens['parent']);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false });
  });

  it('8. reception cannot reach a doctor-only route', async () => {
    const response = await get('/probe/doctor', tokens['reception']);
    expect(response.status).toBe(403);
  });

  it('8b. and the doctor cannot reach a reception-only route', async () => {
    const response = await get('/probe/reception', tokens['doctor']);
    expect(response.status).toBe(403);
  });

  it('9. a suspended member is denied, and told why', async () => {
    // Offboarding is a status change, so this is the normal path for a former
    // member rather than an exotic one.
    const response = await get('/probe/reception', tokens['suspended']);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      // Distinguished from a plain refusal on purpose: the caller is already
      // authenticated as this account, so nothing leaks, and "your account is
      // suspended" is actionable where a blank 403 is not.
      error: { message: expect.stringContaining('suspended') },
    });
  });

  it('10. a member of another clinic never acquires the pilot clinic', async () => {
    const response = await get('/probe/staff', tokens['foreign']);
    expect(response.status).toBe(200);
    // Authorised as reception — at their own clinic, and only there.
    expect(response.body).toMatchObject({
      success: true,
      data: { clinicId: otherClinicId },
    });
  });

  it('11. the clinic comes from the token, never from the request', async () => {
    // A caller naming another tenant in the query string changes nothing: the
    // guard resolved the clinic from the membership behind the token.
    const injected = await get(
      `/probe/staff?clinicId=${otherClinicId}`,
      tokens['reception'],
    );
    expect(injected.status).toBe(200);
    expect(injected.body['data']).not.toMatchObject({
      clinicId: otherClinicId,
    });

    const honest = await get('/probe/staff', tokens['reception']);
    expect(injected.body['data']).toEqual(honest.body['data']);
  });

  it('12. a garbage token is refused without reaching a handler', async () => {
    const response = await get('/probe/authenticated', 'not-a-real-token');
    expect(response.status).toBe(401);
  });
});

import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type ClinicMemberContext,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type {
  ClinicMember,
  ClinicMemberRole,
  ClinicMemberStatus,
} from '@clinic/contracts';

interface MemberRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  role: string;
  status: string;
}

interface ProfileRow extends MemberRow {
  display_name: string;
}

const MEMBER_COLUMNS = 'id, clinic_id, role, status';

/**
 * Staff membership — the fact that turns an authenticated user into someone who
 * may operate a clinic.
 *
 * The projection is the four fields authorisation needs. This runs on every
 * guarded staff request, and it should not load a display name to answer
 * whether somebody may call the next patient.
 */
@Injectable()
export class ClinicMemberService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Resolve membership from the signed-in user.
   *
   * Deliberately not clinic-scoped, for the same reason as the guardian lookup:
   * at sign-in the API holds a token and learns the tenant *from* this row.
   * `clinic_members_auth_user_idx` exists for it.
   *
   * A suspended member is returned rather than hidden. Whether a status may act
   * is an authorisation decision, and it belongs to the guard that makes every
   * other one — hiding the row here would turn "your account is suspended" into
   * an indistinguishable "you are not staff".
   */
  async findByAuthUserId(
    authUserId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicMemberContext | null> {
    const result = await db.query<MemberRow>(
      `select ${MEMBER_COLUMNS} from clinic.clinic_members
        where auth_user_id = $1
        order by case when status = 'active' then 0 else 1 end, id
        limit 1`,
      [authUserId],
    );
    return result.rows[0] ? toContext(result.rows[0]) : null;
  }

  /**
   * The member as a person, for the screen that greets them.
   *
   * Separate from `findByAuthUserId` on purpose. That one runs on every guarded
   * staff request and projects only what authorisation needs; this one runs
   * once, when the dashboard boots, and may afford a display name.
   *
   * Clinic-scoped, unlike the resolver: by the time this is called the tenant
   * is already known from the token, and scoping the read to it means a member
   * id from anywhere else resolves to nothing.
   */
  async findProfile(
    clinicId: string,
    memberId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicMember | null> {
    const result = await db.query<ProfileRow>(
      `select id, clinic_id, role, display_name, status
         from clinic.clinic_members
        where id = $1 and clinic_id = $2`,
      [memberId, clinicId],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          clinicId: row.clinic_id,
          role: row.role as ClinicMemberRole,
          displayName: row.display_name,
          status: row.status as ClinicMemberStatus,
        }
      : null;
  }
}

function toContext(row: MemberRow): ClinicMemberContext {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    role: row.role as ClinicMemberRole,
    status: row.status as ClinicMemberStatus,
  };
}

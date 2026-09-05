import { Injectable } from '@nestjs/common';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { PatientsError, PatientsErrorCode } from './patients.errors';

/**
 * The one place that answers "may this guardian act for this child?".
 *
 * Every parent-facing read leans on it — a child's record, an appointment, a
 * live queue position — so the JOIN exists once rather than being retyped, and
 * slightly differently, at each call site. A single missing clause in one of
 * those copies is how one family ends up reading another's.
 *
 * The answer comes from `guardian_children`. There is no second ownership
 * model, and deliberately no `children.guardian_id` to disagree with it.
 *
 * The clinic is part of every check. A guardian and a child that both exist,
 * but at different clinics, are not related.
 */
@Injectable()
export class GuardianOwnershipService {
  constructor(private readonly database: DatabaseService) {}

  async canAccessChild(
    clinicId: string,
    guardianId: string,
    childId: string,
    db: SqlExecutor = this.database,
  ): Promise<boolean> {
    const result = await db.query<{ owns: boolean }>(
      `select exists (
         select 1
           from clinic.guardian_children gc
           join clinic.children c on c.id = gc.child_id
           join clinic.guardians g on g.id = gc.guardian_id
          where gc.guardian_id = $1
            and gc.child_id = $2
            and c.clinic_id = $3
            and g.clinic_id = $3
       ) as owns`,
      [guardianId, childId, clinicId],
    );
    return result.rows[0]?.owns === true;
  }

  /**
   * Refuse unless the guardian may act for the child.
   *
   * Reports "no such child" rather than "not yours". A guardian probing
   * identifiers should not be able to tell the difference between a child that
   * does not exist and one that belongs to another family — that distinction
   * is itself information about somebody else's patient.
   */
  async assertCanAccessChild(
    clinicId: string,
    guardianId: string,
    childId: string,
    db: SqlExecutor = this.database,
  ): Promise<void> {
    const allowed = await this.canAccessChild(
      clinicId,
      guardianId,
      childId,
      db,
    );
    if (!allowed) {
      throw new PatientsError(
        PatientsErrorCode.ChildNotFound,
        'No such child at this clinic.',
      );
    }
  }

  /** The child ids one guardian may act for. Useful for scoping a list query. */
  async accessibleChildIds(
    clinicId: string,
    guardianId: string,
    db: SqlExecutor = this.database,
  ): Promise<string[]> {
    const result = await db.query<{ child_id: string }>(
      `select gc.child_id
         from clinic.guardian_children gc
         join clinic.children c on c.id = gc.child_id
        where gc.guardian_id = $1 and c.clinic_id = $2`,
      [guardianId, clinicId],
    );
    return result.rows.map((row) => row.child_id);
  }
}

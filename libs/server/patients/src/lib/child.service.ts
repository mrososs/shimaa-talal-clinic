import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type SqlExecutor,
  type QueryResultRow,
} from '@clinic/server-core';
import type {
  Child,
  ChildSex,
  GuardianChild,
  GuardianRelationship,
  IsoDate,
} from '@clinic/contracts';
import {
  PatientsError,
  PatientsErrorCode,
  isUniqueViolation,
} from './patients.errors';

export interface CreateChildInput {
  clinicId: string;
  fullName: string;
  dateOfBirth?: IsoDate | null;
  sex?: ChildSex | null;
  createdByMemberId?: string | null;
}

export interface LinkChildInput {
  clinicId: string;
  guardianId: string;
  childId: string;
  relationship: GuardianRelationship;
  /** At most one guardian per child may be primary. */
  isPrimary?: boolean;
}

export interface UpdateChildInput {
  fullName?: string;
  dateOfBirth?: IsoDate | null;
  sex?: ChildSex | null;
}

interface ChildRow extends QueryResultRow {
  id: string;
  clinic_id: string;
  full_name: string;
  date_of_birth: Date | string | null;
  sex: string | null;
}

interface GuardianChildRow extends ChildRow {
  relationship: string;
  is_primary: boolean;
}

const CHILD_COLUMNS = 'id, clinic_id, full_name, date_of_birth, sex';

/**
 * Children — the patient — and their link to the guardians who bring them in.
 *
 * The link is a row in `guardian_children`, never a column on the child. A
 * child has a mother and a father, and often a grandparent who actually
 * attends; a single `guardian_id` would have made adding the second caregiver a
 * migration that touched every query, every ownership check and every policy.
 *
 * Nothing clinical lives here. Diagnoses, prescriptions, allergies,
 * vaccinations and growth are a medical record this platform does not hold.
 */
@Injectable()
export class ChildService {
  constructor(private readonly database: DatabaseService) {}

  async findById(
    clinicId: string,
    childId: string,
    db: SqlExecutor = this.database,
  ): Promise<Child | null> {
    const result = await db.query<ChildRow>(
      `select ${CHILD_COLUMNS} from clinic.children
        where id = $1 and clinic_id = $2`,
      [childId, clinicId],
    );
    return result.rows[0] ? toChild(result.rows[0]) : null;
  }

  /** The children one guardian may act for, with how they are related. */
  async listForGuardian(
    clinicId: string,
    guardianId: string,
    db: SqlExecutor = this.database,
  ): Promise<GuardianChild[]> {
    const result = await db.query<GuardianChildRow>(
      `select c.id, c.clinic_id, c.full_name, c.date_of_birth, c.sex,
              gc.relationship, gc.is_primary
         from clinic.guardian_children gc
         join clinic.children c on c.id = gc.child_id
        where gc.guardian_id = $1 and c.clinic_id = $2
        order by c.date_of_birth asc nulls last, c.full_name asc`,
      [guardianId, clinicId],
    );
    return result.rows.map((row) => ({
      ...toChild(row),
      relationship: row.relationship as GuardianRelationship,
      isPrimary: row.is_primary,
    }));
  }

  async create(
    input: CreateChildInput,
    db: SqlExecutor = this.database,
  ): Promise<Child> {
    const result = await db.query<ChildRow>(
      `insert into clinic.children
         (clinic_id, full_name, date_of_birth, sex, created_by_member_id)
       values ($1, $2, $3, $4, $5)
       returning ${CHILD_COLUMNS}`,
      [
        input.clinicId,
        input.fullName.trim(),
        input.dateOfBirth ?? null,
        input.sex ?? null,
        input.createdByMemberId ?? null,
      ],
    );
    return toChild(result.rows[0]);
  }

  /**
   * Link an existing child to a guardian.
   *
   * Both must belong to the clinic named here. The guard is a condition inside
   * the INSERT's SELECT rather than a check beforehand, so a child from another
   * clinic cannot be attached even under a race.
   */
  async link(
    input: LinkChildInput,
    db: SqlExecutor = this.database,
  ): Promise<void> {
    let result;
    try {
      result = await db.query(
        `insert into clinic.guardian_children
           (guardian_id, child_id, relationship, is_primary)
         select g.id, c.id, $3, $4
           from clinic.guardians g
           join clinic.children c on c.clinic_id = g.clinic_id
          where g.id = $1 and c.id = $2 and g.clinic_id = $5
         on conflict (guardian_id, child_id) do update
            set relationship = excluded.relationship,
                is_primary = excluded.is_primary`,
        [
          input.guardianId,
          input.childId,
          input.relationship,
          input.isPrimary ?? false,
          input.clinicId,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'guardian_children_primary_uq')) {
        throw new PatientsError(
          PatientsErrorCode.PrimaryGuardianTaken,
          'Another guardian is already the primary caregiver for that child.',
          error,
        );
      }
      throw error;
    }

    // Nothing inserted means the guardian or the child was not in this clinic.
    // Reported as "no such child" without saying which: a caller probing ids
    // should not learn that one exists somewhere else.
    if (result.rowCount === 0) {
      throw new PatientsError(
        PatientsErrorCode.ChildNotFound,
        'No such child at this clinic.',
      );
    }
  }

  /**
   * Create a child and attach it to a guardian as one unit.
   *
   * The two writes are a single fact — "this family has a new child" — and a
   * child with no guardian is unreachable by every parent-facing query, so
   * committing the first without the second would strand it.
   */
  async createForGuardian(
    input: CreateChildInput & {
      guardianId: string;
      relationship: GuardianRelationship;
      isPrimary?: boolean;
    },
    db?: SqlExecutor,
  ): Promise<Child> {
    const run = async (tx: SqlExecutor): Promise<Child> => {
      const child = await this.create(input, tx);
      await this.link(
        {
          clinicId: input.clinicId,
          guardianId: input.guardianId,
          childId: child.id,
          relationship: input.relationship,
          isPrimary: input.isPrimary,
        },
        tx,
      );
      return child;
    };

    // Honour a transaction the caller already owns; open one otherwise. Never
    // nest: an inner transaction takes a second connection that cannot see the
    // outer one's uncommitted rows.
    return db ? run(db) : this.database.transaction(run);
  }

  async update(
    clinicId: string,
    childId: string,
    input: UpdateChildInput,
    db: SqlExecutor = this.database,
  ): Promise<Child> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (input.fullName !== undefined) {
      params.push(input.fullName.trim());
      assignments.push(`full_name = $${params.length}`);
    }
    if (input.dateOfBirth !== undefined) {
      params.push(input.dateOfBirth);
      assignments.push(`date_of_birth = $${params.length}`);
    }
    if (input.sex !== undefined) {
      params.push(input.sex);
      assignments.push(`sex = $${params.length}`);
    }

    if (assignments.length === 0) {
      const current = await this.findById(clinicId, childId, db);
      if (current === null) {
        throw childNotFound();
      }
      return current;
    }

    params.push(childId, clinicId);
    const result = await db.query<ChildRow>(
      `update clinic.children
          set ${assignments.join(', ')}
        where id = $${params.length - 1} and clinic_id = $${params.length}
        returning ${CHILD_COLUMNS}`,
      params,
    );

    if (result.rows[0] === undefined) {
      throw childNotFound();
    }
    return toChild(result.rows[0]);
  }
}

function childNotFound(): PatientsError {
  return new PatientsError(
    PatientsErrorCode.ChildNotFound,
    'No such child at this clinic.',
  );
}

function toChild(row: ChildRow): Child {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    fullName: row.full_name,
    dateOfBirth:
      row.date_of_birth === null ? null : toIsoDate(row.date_of_birth),
    sex: row.sex as ChildSex | null,
  };
}

/**
 * A `date` column carries no time and no zone. The driver hands back a Date at
 * local midnight, so formatting it through anything zone-aware can shift the
 * day. Read the calendar parts directly.
 */
function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

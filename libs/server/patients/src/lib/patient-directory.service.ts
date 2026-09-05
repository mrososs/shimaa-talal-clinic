import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type { ChildSummary, GuardianSummary, IsoDate } from '@clinic/contracts';

interface ChildSummaryRow extends QueryResultRow {
  id: string;
  full_name: string;
  date_of_birth: Date | string | null;
}

interface GuardianSummaryRow extends QueryResultRow {
  id: string;
  full_name: string;
  phone_e164: string;
}

/**
 * Names for rows that other screens already hold the ids of.
 *
 * The queue board and the day's appointment list are lists of *people*, and a
 * board that showed "٢٤" with no name beside it would be unusable at a desk.
 * But neither Booking nor Queue may reach into this domain's tables, so the
 * lookup has to be something this library offers rather than something they
 * take.
 *
 * Both reads are by id set, deliberately. A board is polled every five seconds
 * and holds a whole session; asking for one child at a time would turn a single
 * query into thirty, every five seconds, per member of staff watching. The
 * result is a Map because every caller's next move is a lookup.
 *
 * A summary is the smallest identity that lets a person be recognised —
 * a name, a birthday, a phone number to call them back on. Nothing here is
 * clinical, and nothing here is more than a list needs.
 */
@Injectable()
export class PatientDirectoryService {
  constructor(private readonly database: DatabaseService) {}

  async childSummaries(
    clinicId: string,
    childIds: readonly string[],
    db: SqlExecutor = this.database,
  ): Promise<Map<string, ChildSummary>> {
    if (childIds.length === 0) return new Map();

    const result = await db.query<ChildSummaryRow>(
      `select id, full_name, date_of_birth from clinic.children
        where clinic_id = $1 and id = any($2)`,
      [clinicId, [...new Set(childIds)]],
    );

    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          fullName: row.full_name,
          dateOfBirth:
            row.date_of_birth === null ? null : toIsoDate(row.date_of_birth),
        },
      ]),
    );
  }

  async guardianSummaries(
    clinicId: string,
    guardianIds: readonly string[],
    db: SqlExecutor = this.database,
  ): Promise<Map<string, GuardianSummary>> {
    const wanted = [...new Set(guardianIds)];
    if (wanted.length === 0) return new Map();

    const result = await db.query<GuardianSummaryRow>(
      `select id, full_name, phone_e164 from clinic.guardians
        where clinic_id = $1 and id = any($2)`,
      [clinicId, wanted],
    );

    return new Map(
      result.rows.map((row) => [
        row.id,
        {
          id: row.id,
          fullName: row.full_name,
          phoneE164: row.phone_e164,
        },
      ]),
    );
  }
}

/**
 * A `date` column carries no time and no zone. The driver hands back a Date at
 * local midnight, so formatting it through anything zone-aware can shift the
 * day. Read the calendar parts directly.
 */
function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

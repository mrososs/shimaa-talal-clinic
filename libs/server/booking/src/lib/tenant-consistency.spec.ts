import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from '@clinic/server-core';

const url = testDatabaseUrl();
const migration = readFileSync(
  join(
    __dirname,
    '../../../../../supabase/migrations/20260907105659_booking_queue_tenant_consistency.sql',
  ),
  'utf8',
);

const expected = [
  'appointments_session_clinic_fk',
  'appointments_child_clinic_fk',
  'appointments_guardian_clinic_fk',
  'appointments_rescheduled_from_clinic_fk',
  'queue_entries_session_clinic_fk',
  'queue_entries_appointment_clinic_fk',
  'queue_entries_child_clinic_fk',
  'queue_entries_guardian_clinic_fk',
];

(url === null ? describe.skip : describe)(
  'booking/queue tenant migration',
  () => {
    let db: TestDatabase;

    beforeAll(() => {
      db = createTestDatabase(url as string);
    });

    afterAll(async () => {
      await db.close();
    });

    it('dry-runs and installs every validated composite foreign key', async () => {
      await db.rollback(async (tx) => {
        await tx.query(migration);
        // A database may already contain this migration while a dry-run checks
        // the file again. Reapplying it must preserve the same schema.
        await tx.query(migration);
        const constraints = await tx.query<{
          conname: string;
          definition: string;
          convalidated: boolean;
        }>(
          `select conname, pg_get_constraintdef(oid) as definition, convalidated
           from pg_constraint
          where conname = any($1)
          order by conname`,
          [expected],
        );

        expect(constraints.rows.map((row) => row.conname).sort()).toEqual(
          [...expected].sort(),
        );
        expect(constraints.rows.every((row) => row.convalidated)).toBe(true);
        for (const row of constraints.rows) {
          expect(row.definition).toContain('clinic_id');
          expect(row.definition).toContain('FOREIGN KEY');
        }
      });
    }, 60_000);
  },
);

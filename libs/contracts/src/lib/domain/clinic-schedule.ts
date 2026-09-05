import type { ClinicSessionKind } from './clinic-session-kind';
import type { IsoDate } from './temporal';

/**
 * The weekly template a clinic runs to.
 *
 * Produces `ClinicSession` rows and is never consulted again after that: a
 * session copies the numbers it needs, so editing a schedule in March cannot
 * silently move a session booked in February.
 *
 * Times are local wall-clock (`HH:MM`), not instants. "Ten in the morning"
 * survives a daylight-saving change; a stored instant does not.
 */
export interface ClinicSchedule {
  id: string;
  clinicId: string;
  doctorMemberId: string;

  /** Postgres' own numbering: Sunday is 0, Saturday is 6. */
  weekday: number;
  sessionKind: ClinicSessionKind;

  /** `HH:MM`, in the clinic's timezone. */
  startsAt: string;
  endsAt: string;

  windowMinutes: number;
  capacityPerWindow: number;

  effectiveFrom: IsoDate;
  /** `null` is open-ended. A schedule is superseded by dating it, not deleted. */
  effectiveTo: IsoDate | null;
  active: boolean;
}

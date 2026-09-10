import type { AppointmentStatus } from '../domain/appointment-status';
import type { GuardianChild } from '../domain/child';
import type { Guardian } from '../domain/guardian';
import type { IsoInstant } from '../domain/temporal';
import type { VisitType } from '../domain/visit-type';

/** A booking-history row safe for the operational family record. */
export interface FamilyVisitSummary {
  id: string;
  childId: string;
  windowStart: IsoInstant;
  windowEnd: IsoInstant;
  visitType: VisitType;
  status: AppointmentStatus;
}

/** Cross-domain staff read: identity from Patients and visits from Booking. */
export interface StaffFamilyRecord {
  guardian: Guardian;
  children: GuardianChild[];
  upcomingVisits: FamilyVisitSummary[];
  pastVisits: FamilyVisitSummary[];
}

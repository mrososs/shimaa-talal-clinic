import type { AppointmentStatus } from '../domain/appointment-status';
import type { Appointment } from '../domain/appointment';
import type { QueueStatus } from '../domain/queue-status';
import type { AttendanceIntent } from '../domain/attendance-intent';

export const EstimateConfidence = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type EstimateConfidence =
  (typeof EstimateConfidence)[keyof typeof EstimateConfidence];

export const EstimateUnavailableReason = {
  DoctorStartUnknown: 'doctor_start_unknown',
  ResumeTimeUnknown: 'resume_time_unknown',
  PendingApproval: 'pending_approval',
  SessionClosed: 'session_closed',
} as const;
export type EstimateUnavailableReason =
  (typeof EstimateUnavailableReason)[keyof typeof EstimateUnavailableReason];

export type ArrivalAdvice = 'arrive_at_time' | 'as_soon_as_practical';

/** Stable user-facing estimate. Raw operational calculations never cross here. */
export interface PublishedAppointmentEstimate {
  consultationFrom: string;
  consultationTo: string;
  recommendedArrival: string | null;
  arrivalAdvice: ArrivalAdvice;
  confidence: EstimateConfidence;
  version: number;
  publishedAt: string;
}

export interface AppointmentTrackingView {
  appointmentId: string;
  appointmentStatus: AppointmentStatus;
  windowStart: string;
  windowEnd: string;
  estimate: PublishedAppointmentEstimate | null;
  unavailableReason: EstimateUnavailableReason | null;
  attendanceIntent: AttendanceIntent;
  attendanceEnabled: boolean;
  queue: {
    ticketNumber: number;
    status: QueueStatus;
    aheadCount: number;
    graceExpiresAt: string | null;
  } | null;
}

export interface StaffEstimateDiagnostic {
  appointmentId: string;
  rawEstimate: Omit<PublishedAppointmentEstimate, 'version' | 'publishedAt'> | null;
  publishedEstimate: PublishedAppointmentEstimate | null;
  unavailableReason: EstimateUnavailableReason | null;
  rawDriftMinutes: number | null;
  confirmedAheadCount: number;
  requestedAheadCount: number;
  paceSampleCount: number;
  baselineSource: 'clinic_configured' | 'historical' | 'product_default';
  confidence: EstimateConfidence | null;
  confidenceReasons: string[];
}

export interface AppointmentTrackingCapability {
  token: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

export interface TrackingLinkRotation {
  rotated: true;
  token: string;
  expiresAt: string;
}

/** Backward-compatible appointment result with one-time rotation metadata. */
export interface RescheduledAppointment extends Appointment {
  trackingLinkRotation: TrackingLinkRotation | null;
}

import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import type { Clinic } from '@clinic/contracts';

interface ClinicRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_country_code: string;
  grace_period_minutes: number;
  max_self_defers: number;
  auto_confirm_parent_bookings: boolean;
  today: string;
}

/**
 * `today` is computed by the server, in the clinic's own zone.
 *
 * The clinic's day boundary is its own — Africa/Cairo for the pilot — never the
 * API host's and never the viewer's. At 22:30 UTC it is already tomorrow in
 * Cairo, so a caller deriving "today" from its own clock would ask for the
 * wrong day's appointments for three hours every night.
 */
const CLINIC_COLUMNS = `
  id, name, slug, timezone, default_country_code,
  grace_period_minutes, max_self_defers, auto_confirm_parent_bookings,
  (now() at time zone timezone)::date::text as today
`;

/**
 * Clinic identity and the policy every other domain needs to read.
 *
 * Deliberately narrow: it answers "what are this clinic's settings", nothing
 * about when it is open. Schedules and sessions are a separate concern and a
 * separate task; nothing here anticipates them.
 */
@Injectable()
export class ClinicService {
  constructor(private readonly database: DatabaseService) {}

  async findById(
    clinicId: string,
    db: SqlExecutor = this.database,
  ): Promise<Clinic | null> {
    const result = await db.query<ClinicRow>(
      `select ${CLINIC_COLUMNS} from clinic.clinics where id = $1 and active`,
      [clinicId],
    );
    return result.rows[0] ? toClinic(result.rows[0]) : null;
  }

  /** Used by bootstrap and tooling, which know a clinic by name, not by id. */
  async findBySlug(
    slug: string,
    db: SqlExecutor = this.database,
  ): Promise<Clinic | null> {
    const result = await db.query<ClinicRow>(
      `select ${CLINIC_COLUMNS} from clinic.clinics where slug = $1 and active`,
      [slug],
    );
    return result.rows[0] ? toClinic(result.rows[0]) : null;
  }

  /**
   * The operating rules other domains enforce on the clinic's behalf.
   *
   * Separate from `findById` because these are not for clients. `Clinic` is a
   * contract a browser receives; these are numbers Booking applies and nobody
   * renders — a cancellation cutoff is a rule, not a label.
   *
   * Booking asks for them here rather than reading `clinic.clinics` itself, so
   * the columns stay owned by one library.
   */
  async findPolicy(
    clinicId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicPolicy | null> {
    const result = await db.query<PolicyRow>(
      `select auto_confirm_parent_bookings, min_lead_minutes,
              cancellation_cutoff_minutes, grace_period_minutes,
              max_self_defers
         from clinic.clinics where id = $1 and active`,
      [clinicId],
    );
    const row = result.rows[0];
    return row
      ? {
          autoConfirmParentBookings: row.auto_confirm_parent_bookings,
          minLeadMinutes: row.min_lead_minutes,
          cancellationCutoffMinutes: row.cancellation_cutoff_minutes,
          gracePeriodMinutes: row.grace_period_minutes,
          maxSelfDefers: row.max_self_defers,
        }
      : null;
  }

  /** Estimator and staged-release configuration, owned by the clinic tenant. */
  async findTrackingPolicy(
    clinicId: string,
    db: SqlExecutor = this.database,
  ): Promise<ClinicTrackingPolicy | null> {
    const result = await db.query<TrackingPolicyRow>(
      `select tracking_estimator_enabled, reception_estimate_visible,
              parent_estimate_visible, guest_tracking_enabled,
              attendance_intent_enabled, fairness_placement_enabled,
              arrival_buffer_minutes, early_check_in_minutes,
              minimum_travel_lead_minutes,
              estimate_publication_threshold_minutes,
              max_earlier_shift_minutes, configured_baseline_minutes,
              baseline_source, baseline_validated_at,
              parent_estimate_approved_at
         from clinic.clinics where id=$1 and active`,
      [clinicId],
    );
    const row = result.rows[0];
    return row
      ? {
          estimatorEnabled: row.tracking_estimator_enabled,
          receptionVisible: row.reception_estimate_visible,
          parentVisible: row.parent_estimate_visible,
          guestEnabled: row.guest_tracking_enabled,
          attendanceEnabled: row.attendance_intent_enabled,
          fairnessEnabled: row.fairness_placement_enabled,
          arrivalBufferMinutes: row.arrival_buffer_minutes,
          earlyCheckInMinutes: row.early_check_in_minutes,
          minimumTravelLeadMinutes: row.minimum_travel_lead_minutes,
          publicationThresholdMinutes:
            row.estimate_publication_threshold_minutes,
          maxEarlierShiftMinutes: row.max_earlier_shift_minutes,
          configuredBaselineMinutes: row.configured_baseline_minutes,
          baselineSource: row.baseline_source,
          baselineValidatedAt:
            row.baseline_validated_at?.toISOString() ?? null,
          parentEstimateApprovedAt:
            row.parent_estimate_approved_at?.toISOString() ?? null,
        }
      : null;
  }
}

/** Clinic rules the domains apply. Deliberately not part of any API contract. */
export interface ClinicPolicy {
  autoConfirmParentBookings: boolean;
  /** How close to a window the clinic still accepts a booking. */
  minLeadMinutes: number;
  /** How long before a window a parent may still cancel or reschedule. */
  cancellationCutoffMinutes: number;
  gracePeriodMinutes: number;
  maxSelfDefers: number;
}

interface PolicyRow extends QueryResultRow {
  auto_confirm_parent_bookings: boolean;
  min_lead_minutes: number;
  cancellation_cutoff_minutes: number;
  grace_period_minutes: number;
  max_self_defers: number;
}

export interface ClinicTrackingPolicy {
  estimatorEnabled: boolean;
  receptionVisible: boolean;
  parentVisible: boolean;
  guestEnabled: boolean;
  attendanceEnabled: boolean;
  fairnessEnabled: boolean;
  arrivalBufferMinutes: number;
  earlyCheckInMinutes: number;
  minimumTravelLeadMinutes: number;
  publicationThresholdMinutes: number;
  maxEarlierShiftMinutes: number;
  configuredBaselineMinutes: number | null;
  baselineSource: 'clinic_configured' | 'historical' | null;
  baselineValidatedAt: string | null;
  parentEstimateApprovedAt: string | null;
}

interface TrackingPolicyRow extends QueryResultRow {
  tracking_estimator_enabled: boolean;
  reception_estimate_visible: boolean;
  parent_estimate_visible: boolean;
  guest_tracking_enabled: boolean;
  attendance_intent_enabled: boolean;
  fairness_placement_enabled: boolean;
  arrival_buffer_minutes: number;
  early_check_in_minutes: number;
  minimum_travel_lead_minutes: number;
  estimate_publication_threshold_minutes: number;
  max_earlier_shift_minutes: number;
  configured_baseline_minutes: number | null;
  baseline_source: 'clinic_configured' | 'historical' | null;
  baseline_validated_at: Date | null;
  parent_estimate_approved_at: Date | null;
}

function toClinic(row: ClinicRow): Clinic {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    defaultCountryCode: row.default_country_code,
    gracePeriodMinutes: row.grace_period_minutes,
    maxSelfDefers: row.max_self_defers,
    autoConfirmParentBookings: row.auto_confirm_parent_bookings,
    today: row.today,
  };
}

import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import {
  AppointmentStatus,
  AttendanceIntent,
  ClinicSessionStatus,
  DoctorPresence,
  EstimateConfidence,
  EstimateUnavailableReason,
  type AppointmentTrackingView,
  type Appointment,
  type PublishedAppointmentEstimate,
  type StaffEstimateDiagnostic,
} from '@clinic/contracts';
import { ClinicService, type ClinicTrackingPolicy } from '@clinic/server-clinic';
import {
  AppointmentService,
  BookingError,
  BookingErrorCode,
} from '@clinic/server-booking';
import { QueueEntryService } from '@clinic/server-queue';

const PRODUCT_DEFAULT_BASELINE = 15;
const HIGH_STABILITY_MINUTES = 15;
const MIN_CURRENT_SAMPLES = 3;

interface TrackingSeedRow extends QueryResultRow {
  appointment_id: string;
  clinic_id: string;
  session_id: string;
  appointment_status: AppointmentStatus;
  attendance_intent: AppointmentTrackingView['attendanceIntent'];
  window_start: Date;
  window_end: Date;
  planned_start: Date;
  planned_end: Date;
  session_status: ClinicSessionStatus;
  doctor_presence: DoctorPresence;
  expected_start_at: Date | null;
  doctor_arrived_at: Date | null;
  expected_resume_at: Date | null;
  session_revision: string;
  booking_revision: string;
  last_timing_change_at: Date | null;
  active_queue_count: string;
  confirmed_ahead_count: string;
  requested_ahead_count: string;
}

interface SnapshotRow extends QueryResultRow {
  published_consultation_from: Date | null;
  published_consultation_to: Date | null;
  published_recommended_arrival: Date | null;
  published_arrival_advice: 'arrive_at_time' | 'as_soon_as_practical' | null;
  published_unavailable_reason: EstimateUnavailableReason | null;
  published_confidence: EstimateConfidence | null;
  published_version: string;
  published_at: Date | null;
  last_earlier_shift_at: Date | null;
}

export interface RawEstimate {
  consultationFrom: string;
  consultationTo: string;
  recommendedArrival: string | null;
  arrivalAdvice: 'arrive_at_time' | 'as_soon_as_practical';
  confidence: EstimateConfidence;
  confidenceReasons: string[];
  confirmedAheadCount: number;
  requestedAheadCount: number;
  paceSampleCount: number;
  baselineSource: 'clinic_configured' | 'historical' | 'product_default';
}

export interface EstimateCalculation {
  raw: RawEstimate | null;
  unavailableReason: EstimateUnavailableReason | null;
}

export interface CalculateEstimateInput {
  now: Date;
  appointmentStatus: AppointmentStatus;
  windowStart: Date;
  plannedStart: Date;
  sessionStatus: ClinicSessionStatus;
  doctorPresence: DoctorPresence;
  expectedStartAt: Date | null;
  doctorArrivedAt: Date | null;
  expectedResumeAt: Date | null;
  lastTimingChangeAt: Date | null;
  activeQueueCount: number;
  confirmedAheadCount: number;
  requestedAheadCount: number;
  baselineMinutes: number;
  baselineValidated: boolean;
  baselineSource: RawEstimate['baselineSource'];
  currentPaceSamples: number[];
  policy: Pick<
    ClinicTrackingPolicy,
    'arrivalBufferMinutes' | 'earlyCheckInMinutes'
  >;
}

/** Pure deterministic estimator. All time enters through `input.now`. */
export function calculateEstimate(
  input: CalculateEstimateInput,
): EstimateCalculation {
  if (input.appointmentStatus === AppointmentStatus.Requested) {
    return { raw: null, unavailableReason: EstimateUnavailableReason.PendingApproval };
  }
  if (input.sessionStatus === ClinicSessionStatus.Closed) {
    return { raw: null, unavailableReason: EstimateUnavailableReason.SessionClosed };
  }

  let anchor = input.expectedStartAt ?? input.plannedStart;
  if (input.sessionStatus === ClinicSessionStatus.Paused) {
    if (input.expectedResumeAt === null) {
      return {
        raw: null,
        unavailableReason: EstimateUnavailableReason.ResumeTimeUnknown,
      };
    }
    anchor = input.expectedResumeAt;
  } else if (
    input.now.getTime() > input.plannedStart.getTime() &&
    input.doctorPresence !== DoctorPresence.Arrived &&
    input.doctorArrivedAt === null &&
    input.expectedStartAt === null
  ) {
    return {
      raw: null,
      unavailableReason: EstimateUnavailableReason.DoctorStartUnknown,
    };
  } else if (
    input.doctorPresence === DoctorPresence.Arrived ||
    input.doctorArrivedAt !== null ||
    input.sessionStatus === ClinicSessionStatus.Open
  ) {
    anchor = new Date(Math.max(input.now.getTime(), anchor.getTime()));
  }

  const samples = input.currentPaceSamples.slice(-5);
  const observed = samples.length >= MIN_CURRENT_SAMPLES ? median(samples) : null;
  const pace = observed === null
    ? input.baselineMinutes
    : clamp(Math.round((observed * 2 + input.baselineMinutes) / 3),
        Math.max(2, Math.round(input.baselineMinutes * 0.5)),
        Math.min(120, Math.round(input.baselineMinutes * 2)));

  const confirmedAhead = input.activeQueueCount + input.confirmedAheadCount;
  const from = new Date(anchor.getTime() + confirmedAhead * pace * 60_000);
  const to = new Date(from.getTime() + Math.max(5, pace) * 60_000);
  const recommendationRaw = new Date(
    from.getTime() - input.policy.arrivalBufferMinutes * 60_000,
  );
  const minimumAllowed = new Date(
    input.windowStart.getTime() - input.policy.earlyCheckInMinutes * 60_000,
  );
  const recommendation = roundToFive(
    new Date(Math.max(recommendationRaw.getTime(), minimumAllowed.getTime())),
  );

  const requestedRatio = input.requestedAheadCount /
    Math.max(1, input.requestedAheadCount + input.confirmedAheadCount);
  const recentTimingChange = input.lastTimingChangeAt !== null &&
    input.now.getTime() - input.lastTimingChangeAt.getTime() <
      HIGH_STABILITY_MINUTES * 60_000;
  const confidenceReasons: string[] = [];
  if (input.sessionStatus !== ClinicSessionStatus.Open)
    confidenceReasons.push('session_not_started');
  if (input.sessionStatus === ClinicSessionStatus.Paused)
    confidenceReasons.push('session_paused');
  if (samples.length === 0) confidenceReasons.push('no_current_pace_samples');
  if (!input.baselineValidated) confidenceReasons.push('baseline_unvalidated');
  if (input.requestedAheadCount >= 3 && requestedRatio >= 0.4)
    confidenceReasons.push('requested_workload_uncertain');
  if (recentTimingChange) confidenceReasons.push('recent_timing_change');
  if (input.baselineSource === 'product_default')
    confidenceReasons.push('product_default_baseline');

  const high =
    input.sessionStatus === ClinicSessionStatus.Open &&
    (input.doctorPresence === DoctorPresence.Arrived || input.doctorArrivedAt !== null) &&
    samples.length >= MIN_CURRENT_SAMPLES &&
    input.baselineValidated &&
    requestedRatio <= 0.1 &&
    !recentTimingChange;

  return {
    raw: {
      consultationFrom: roundToFive(from).toISOString(),
      consultationTo: roundToFive(to).toISOString(),
      recommendedArrival:
        recommendation.getTime() <= input.now.getTime()
          ? null
          : recommendation.toISOString(),
      arrivalAdvice:
        recommendation.getTime() <= input.now.getTime()
          ? 'as_soon_as_practical'
          : 'arrive_at_time',
      confidence: confidenceReasons.length > 0
        ? EstimateConfidence.Low
        : high
          ? EstimateConfidence.High
          : EstimateConfidence.Medium,
      confidenceReasons,
      confirmedAheadCount: confirmedAhead,
      requestedAheadCount: input.requestedAheadCount,
      paceSampleCount: samples.length,
      baselineSource: input.baselineSource,
    },
    unavailableReason: null,
  };
}

@Injectable()
export class AppointmentTrackingWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly clinics: ClinicService,
    private readonly appointments: AppointmentService,
    private readonly queueEntries: QueueEntryService,
  ) {}

  async parentView(
    clinicId: string,
    guardianId: string,
    appointmentId: string,
  ): Promise<AppointmentTrackingView> {
    const appointment = await this.appointments.findById(clinicId, appointmentId);
    if (appointment === null || appointment.guardianId !== guardianId) {
      throw new BookingError(
        BookingErrorCode.AppointmentNotFound,
        'No such appointment.',
      );
    }
    const result = await this.materialize(clinicId, appointmentId);
    const policy = await this.requirePolicy(clinicId);
    const queue = await this.queueEntries.findByAppointment(clinicId, appointmentId);
    return {
      appointmentId,
      appointmentStatus: appointment.status,
      windowStart: appointment.windowStart,
      windowEnd: appointment.windowEnd,
      estimate:
        policy.parentVisible && policy.baselineValidatedAt !== null &&
        policy.parentEstimateApprovedAt !== null
          ? result.publishedEstimate
          : null,
      unavailableReason:
        policy.parentVisible ? result.unavailableReason : null,
      attendanceIntent: appointment.attendanceIntent,
      attendanceEnabled: policy.attendanceEnabled,
      queue: queue
        ? {
            ticketNumber: queue.ticketNumber,
            status: queue.status,
            aheadCount: await this.queueEntries.aheadCount(queue.id),
            graceExpiresAt: queue.graceExpiresAt,
          }
        : null,
    };
  }

  /** Capability owner already proved access; no family identity is accepted. */
  async guestView(
    clinicId: string,
    appointmentId: string,
  ): Promise<AppointmentTrackingView> {
    const policy = await this.requirePolicy(clinicId);
    if (!policy.guestEnabled) {
      throw new BookingError(
        BookingErrorCode.AppointmentNotFound,
        'Tracking link is unavailable.',
      );
    }
    const appointment = await this.appointments.findById(clinicId, appointmentId);
    if (appointment === null) {
      throw new BookingError(
        BookingErrorCode.AppointmentNotFound,
        'Tracking link is unavailable.',
      );
    }
    const result = await this.materialize(clinicId, appointmentId);
    const queue = await this.queueEntries.findByAppointment(clinicId, appointmentId);
    return {
      appointmentId,
      appointmentStatus: appointment.status,
      windowStart: appointment.windowStart,
      windowEnd: appointment.windowEnd,
      estimate:
        policy.parentVisible && policy.baselineValidatedAt !== null &&
        policy.parentEstimateApprovedAt !== null
          ? result.publishedEstimate
          : null,
      unavailableReason: policy.parentVisible ? result.unavailableReason : null,
      attendanceIntent: appointment.attendanceIntent,
      attendanceEnabled: policy.attendanceEnabled,
      queue: queue ? {
        ticketNumber: queue.ticketNumber,
        status: queue.status,
        aheadCount: await this.queueEntries.aheadCount(queue.id),
        graceExpiresAt: queue.graceExpiresAt,
      } : null,
    };
  }

  async setAttendance(
    clinicId: string,
    guardianId: string,
    authUserId: string,
    appointmentId: string,
    intent: Exclude<AttendanceIntent, 'unknown'>,
  ): Promise<AppointmentTrackingView> {
    await this.database.transaction(async (tx) => {
      const appointment = await this.appointments.findByIdForUpdate(
        clinicId,
        appointmentId,
        tx,
      );
      if (
        appointment === null ||
        appointment.guardianId !== guardianId ||
        appointment.status !== AppointmentStatus.Confirmed
      ) {
        throw new BookingError(
          BookingErrorCode.AppointmentNotFound,
          'No eligible appointment.',
        );
      }
      await this.writeAttendance(
        clinicId,
        appointment,
        intent,
        authUserId,
        tx,
      );
    });
    return this.parentView(clinicId, guardianId, appointmentId);
  }

  /** A valid opaque capability is the authority; no family identity is read. */
  async setGuestAttendance(
    clinicId: string,
    appointmentId: string,
    intent: Exclude<AttendanceIntent, 'unknown'>,
  ): Promise<AppointmentTrackingView> {
    await this.database.transaction(async (tx) => {
      const appointment = await this.appointments.findByIdForUpdate(
        clinicId,
        appointmentId,
        tx,
      );
      if (appointment?.status !== AppointmentStatus.Confirmed) {
        throw new BookingError(
          BookingErrorCode.AppointmentNotFound,
          'No eligible appointment.',
        );
      }
      await this.writeAttendance(clinicId, appointment, intent, null, tx);
    });
    return this.guestView(clinicId, appointmentId);
  }

  private async writeAttendance(
    clinicId: string,
    appointment: Appointment,
    intent: Exclude<AttendanceIntent, 'unknown'>,
    authUserId: string | null,
    tx: SqlExecutor,
  ): Promise<void> {
    const policy = await this.requirePolicy(clinicId, tx);
    if (!policy.attendanceEnabled) {
      throw new BookingError(
        BookingErrorCode.InvalidTransition,
        'Attendance intent is not enabled for this clinic.',
      );
    }
    if (appointment.attendanceIntent === intent) return;
    await tx.query(
      `update clinic.appointments
          set attendance_intent=$3, attendance_intent_set_at=now(),
              attendance_intent_set_by_auth_user_id=$4
        where id=$1 and clinic_id=$2`,
      [appointment.id, clinicId, intent, authUserId],
    );
    await tx.query(
      `update clinic.clinic_sessions
          set booking_revision=booking_revision+1 where id=$1`,
      [appointment.sessionId],
    );
    await tx.query(
      `insert into clinic.appointment_events
        (appointment_id,event_type,from_status,to_status,
         performed_by_auth_user_id,metadata)
       values($1,'attendance_changed',$2,$2,$3,$4)`,
      [appointment.id, appointment.status, authUserId,
        JSON.stringify({ from: appointment.attendanceIntent, to: intent })],
    );
    await tx.query(
      `insert into clinic.appointment_tracking_events
        (clinic_id,appointment_id,event_type,metadata)
       values($1,$2,'attendance_changed',$3)`,
      [clinicId, appointment.id,
        JSON.stringify({ from: appointment.attendanceIntent, to: intent })],
    );
  }

  async staffDiagnostic(
    clinicId: string,
    appointmentId: string,
  ): Promise<StaffEstimateDiagnostic> {
    const policy = await this.requirePolicy(clinicId);
    const result = await this.materialize(clinicId, appointmentId);
    if (!policy.receptionVisible) {
      return {
        appointmentId,
        rawEstimate: null,
        publishedEstimate: null,
        unavailableReason: null,
        rawDriftMinutes: null,
        confirmedAheadCount: 0,
        requestedAheadCount: 0,
        paceSampleCount: 0,
        baselineSource: 'product_default',
        confidence: null,
        confidenceReasons: [],
      };
    }
    const raw = result.calculation.raw;
    return {
      appointmentId,
      rawEstimate: raw ? publicEstimate(raw) : null,
      publishedEstimate: result.publishedEstimate,
      unavailableReason: result.unavailableReason,
      rawDriftMinutes:
        raw && result.publishedEstimate
          ? Math.round(
              (Date.parse(raw.consultationFrom) -
                Date.parse(result.publishedEstimate.consultationFrom)) /
                60_000,
            )
          : null,
      confirmedAheadCount: raw?.confirmedAheadCount ?? 0,
      requestedAheadCount: raw?.requestedAheadCount ?? 0,
      paceSampleCount: raw?.paceSampleCount ?? 0,
      baselineSource: raw?.baselineSource ?? 'product_default',
      confidence: raw?.confidence ?? null,
      confidenceReasons: raw?.confidenceReasons ?? [],
    };
  }

  private async materialize(clinicId: string, appointmentId: string) {
    return this.database.transaction(async (tx) => {
      const policy = await this.requirePolicy(clinicId, tx);
      const seed = await this.seed(clinicId, appointmentId, tx);
      if (!policy.estimatorEnabled) {
        return {
          calculation: { raw: null, unavailableReason: null },
          publishedEstimate: null,
          unavailableReason: null,
        } satisfies {
          calculation: EstimateCalculation;
          publishedEstimate: PublishedAppointmentEstimate | null;
          unavailableReason: EstimateUnavailableReason | null;
        };
      }
      const pace = await this.pace(seed, policy, tx);
      const calculation = calculateEstimate({
            now: new Date(),
            appointmentStatus: seed.appointment_status,
            windowStart: seed.window_start,
            plannedStart: seed.planned_start,
            sessionStatus: seed.session_status,
            doctorPresence: seed.doctor_presence,
            expectedStartAt: seed.expected_start_at,
            doctorArrivedAt: seed.doctor_arrived_at,
            expectedResumeAt: seed.expected_resume_at,
            lastTimingChangeAt: seed.last_timing_change_at,
            activeQueueCount: Number(seed.active_queue_count),
            confirmedAheadCount: Number(seed.confirmed_ahead_count),
            requestedAheadCount: Number(seed.requested_ahead_count),
            baselineMinutes: pace.baselineMinutes,
            baselineValidated: pace.baselineValidated,
            baselineSource: pace.baselineSource,
            currentPaceSamples: pace.currentSamples,
            policy,
          });
      const snapshot = await this.publish(seed, policy, calculation, tx);
      return {
        calculation,
        publishedEstimate: snapshotEstimate(snapshot),
        unavailableReason: snapshot.published_unavailable_reason,
      };
    });
  }

  private async requirePolicy(clinicId: string, db?: SqlExecutor) {
    const policy = await this.clinics.findTrackingPolicy(clinicId, db);
    if (policy === null) throw new Error('Clinic not found.');
    return policy;
  }

  private async seed(clinicId: string, appointmentId: string, tx: SqlExecutor) {
    const result = await tx.query<TrackingSeedRow>(
      `select a.id appointment_id, a.clinic_id, a.session_id,
              a.status appointment_status, a.attendance_intent,
              a.window_start, a.window_end,
              s.planned_start, s.planned_end, s.status session_status,
              s.doctor_presence, s.expected_start_at, s.doctor_arrived_at,
              s.expected_resume_at, s.revision::text session_revision,
              s.booking_revision::text booking_revision,
              greatest(s.presence_updated_at, s.updated_at) last_timing_change_at,
              (select count(*)::text from clinic.queue_entries q
                where q.session_id=s.id and q.status in ('waiting','called','in_service'))
                active_queue_count,
              (select count(*)::text from clinic.appointments ahead
                where ahead.session_id=s.id and ahead.status='confirmed'
                  and (ahead.window_start, ahead.seat_no, ahead.created_at)
                    < (a.window_start, a.seat_no, a.created_at)) confirmed_ahead_count,
              (select count(*)::text from clinic.appointments ahead
                where ahead.session_id=s.id and ahead.status='requested'
                  and (ahead.window_start, ahead.seat_no, ahead.created_at)
                    < (a.window_start, a.seat_no, a.created_at)) requested_ahead_count
         from clinic.appointments a
         join clinic.clinic_sessions s
           on s.id=a.session_id and s.clinic_id=a.clinic_id
        where a.id=$1 and a.clinic_id=$2
        for update of a, s`,
      [appointmentId, clinicId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Appointment not found.');
    return row;
  }

  private async pace(
    seed: TrackingSeedRow,
    policy: ClinicTrackingPolicy,
    tx: SqlExecutor,
  ) {
    const current = await tx.query<{ minutes: number }>(
      `select extract(epoch from (completed_at-started_at))/60 minutes
         from clinic.queue_entries
        where session_id=$1 and status='done' and started_at is not null
          and completed_at > started_at
          and extract(epoch from (completed_at-started_at))/60 between 2 and 120
        order by completed_at desc limit 5`,
      [seed.session_id],
    );
    if (
      policy.configuredBaselineMinutes !== null &&
      policy.baselineValidatedAt !== null
    ) {
      return {
        baselineMinutes: policy.configuredBaselineMinutes,
        baselineValidated: true,
        baselineSource: (policy.baselineSource ?? 'clinic_configured') as
          RawEstimate['baselineSource'],
        currentSamples: current.rows.map((row) => Number(row.minutes)),
      };
    }
    const historical = await tx.query<{ minutes: number; sessions: string }>(
      `select percentile_cont(.5) within group (
                order by extract(epoch from (q.completed_at-q.started_at))/60
              )::float8 minutes,
              count(distinct q.session_id)::text sessions
         from clinic.queue_entries q
         join clinic.clinic_sessions hs on hs.id=q.session_id
        where q.clinic_id=$1 and q.status='done' and q.started_at is not null
          and q.completed_at > q.started_at
          and hs.session_date >= current_date-60
          and extract(epoch from (q.completed_at-q.started_at))/60 between 2 and 120
       having count(*) >= 20`,
      [seed.clinic_id],
    );
    const history = historical.rows[0];
    const validHistory = history !== undefined && Number(history.sessions) >= 3;
    return {
      baselineMinutes: validHistory
        ? Math.round(Number(history.minutes))
        : PRODUCT_DEFAULT_BASELINE,
      baselineValidated: validHistory,
      baselineSource: validHistory ? 'historical' as const : 'product_default' as const,
      currentSamples: current.rows.map((row) => Number(row.minutes)),
    };
  }

  private async publish(
    seed: TrackingSeedRow,
    policy: ClinicTrackingPolicy,
    calculation: EstimateCalculation,
    tx: SqlExecutor,
  ): Promise<SnapshotRow> {
    const existingResult = await tx.query<SnapshotRow>(
      `select published_consultation_from, published_consultation_to,
              published_recommended_arrival, published_arrival_advice,
              published_unavailable_reason, published_confidence,
              published_version::text, published_at, last_earlier_shift_at
         from clinic.appointment_tracking_state
        where appointment_id=$1 for update`,
      [seed.appointment_id],
    );
    const existing = existingResult.rows[0];
    const normalized = stabilize(
      calculation,
      existing,
      policy,
      new Date(),
      seed.appointment_status,
      seed.attendance_intent,
    );
    if (existing && !normalized.changed) return existing;
    const nextVersion = Number(existing?.published_version ?? 0) + 1;
    const mode = policy.parentVisible && policy.baselineValidatedAt !== null &&
      policy.parentEstimateApprovedAt !== null ? 'parent_visible' : 'shadow';
    const row = await tx.query<SnapshotRow>(
      `insert into clinic.appointment_tracking_state (
         appointment_id, clinic_id, source_session_revision,
         source_booking_revision, published_consultation_from,
         published_consultation_to, published_recommended_arrival,
         published_arrival_advice, published_unavailable_reason,
         published_confidence, publication_mode, published_version,
         published_at, last_earlier_shift_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13)
       on conflict (appointment_id) do update set
         source_session_revision=excluded.source_session_revision,
         source_booking_revision=excluded.source_booking_revision,
         published_consultation_from=excluded.published_consultation_from,
         published_consultation_to=excluded.published_consultation_to,
         published_recommended_arrival=excluded.published_recommended_arrival,
         published_arrival_advice=excluded.published_arrival_advice,
         published_unavailable_reason=excluded.published_unavailable_reason,
         published_confidence=excluded.published_confidence,
         publication_mode=excluded.publication_mode,
         published_version=excluded.published_version,
         published_at=excluded.published_at,
         last_earlier_shift_at=excluded.last_earlier_shift_at
       returning published_consultation_from, published_consultation_to,
         published_recommended_arrival, published_arrival_advice,
         published_unavailable_reason, published_confidence,
         published_version::text, published_at, last_earlier_shift_at`,
      [
        seed.appointment_id,
        seed.clinic_id,
        seed.session_revision,
        seed.booking_revision,
        normalized.from,
        normalized.to,
        normalized.recommended,
        normalized.advice,
        normalized.reason,
        normalized.confidence,
        mode,
        nextVersion,
        normalized.lastEarlierShiftAt,
      ],
    );
    await tx.query(
      `insert into clinic.appointment_tracking_events
         (clinic_id,appointment_id,event_type,published_version,metadata)
       values($1,$2,$3,$4,$5)`,
      [seed.clinic_id, seed.appointment_id,
        mode === 'parent_visible' ? 'parent_published' : 'shadow_published',
        nextVersion, JSON.stringify({
          confidence: normalized.confidence,
          consultationFrom: normalized.from,
          consultationTo: normalized.to,
          recommendedArrival: normalized.recommended,
          unavailableReason: normalized.reason,
        })],
    );
    return row.rows[0];
  }
}

interface StabilizedSnapshot {
  changed: boolean;
  from?: string | null;
  to?: string | null;
  recommended?: string | null;
  advice?: 'arrive_at_time' | 'as_soon_as_practical' | null;
  reason?: EstimateUnavailableReason | null;
  confidence?: EstimateConfidence | null;
  lastEarlierShiftAt?: Date | null;
}

function stabilize(
  calculation: EstimateCalculation,
  existing: SnapshotRow | undefined,
  policy: ClinicTrackingPolicy,
  now: Date,
  status: AppointmentStatus,
  attendanceIntent: AttendanceIntent,
): StabilizedSnapshot {
  const terminal: readonly AppointmentStatus[] = [
    AppointmentStatus.CheckedIn,
    AppointmentStatus.Completed,
    AppointmentStatus.Cancelled,
    AppointmentStatus.NoShow,
  ];
  const isTerminal = terminal.includes(status);
  if (calculation.raw === null || isTerminal) {
    const reason = isTerminal ? null : calculation.unavailableReason;
    const changed = !existing || existing.published_unavailable_reason !== reason ||
      existing.published_consultation_from !== null;
    return { changed, from: null, to: null, recommended: null, advice: null,
      reason, confidence: null, lastEarlierShiftAt: existing?.last_earlier_shift_at ?? null };
  }
  const raw = calculation.raw;
  if (!existing || existing.published_consultation_from === null) {
    return { changed: true, from: raw.consultationFrom, to: raw.consultationTo,
      recommended: raw.recommendedArrival, advice: raw.arrivalAdvice,
      reason: null, confidence: raw.confidence, lastEarlierShiftAt: null };
  }
  const drift = Math.abs(Date.parse(raw.consultationFrom) -
    existing.published_consultation_from.getTime()) / 60_000;
  const confidenceChanged = existing.published_confidence !== raw.confidence;
  if (drift < policy.publicationThresholdMinutes && !confidenceChanged) {
    return { changed: false };
  }
  let recommended = raw.recommendedArrival;
  let lastEarlierShiftAt = existing.last_earlier_shift_at;
  if (
    attendanceIntent === AttendanceIntent.Coming &&
    existing.published_recommended_arrival
  ) {
    recommended = existing.published_recommended_arrival.toISOString();
  } else if (recommended && existing.published_recommended_arrival &&
      Date.parse(recommended) < existing.published_recommended_arrival.getTime()) {
    const intervalOpen = !lastEarlierShiftAt ||
      now.getTime() - lastEarlierShiftAt.getTime() >= 15 * 60_000;
    if (!intervalOpen) recommended = existing.published_recommended_arrival.toISOString();
    else {
      const protectedAt = Math.max(
        Date.parse(recommended),
        now.getTime() + policy.minimumTravelLeadMinutes * 60_000,
        existing.published_recommended_arrival.getTime() -
          policy.maxEarlierShiftMinutes * 60_000,
      );
      recommended = protectedAt < existing.published_recommended_arrival.getTime()
        ? new Date(protectedAt).toISOString()
        : existing.published_recommended_arrival.toISOString();
      if (protectedAt < existing.published_recommended_arrival.getTime())
        lastEarlierShiftAt = now;
    }
  }
  return { changed: true, from: raw.consultationFrom, to: raw.consultationTo,
    recommended, advice: recommended ? 'arrive_at_time' : raw.arrivalAdvice,
    reason: null, confidence: raw.confidence, lastEarlierShiftAt };
}

function snapshotEstimate(row: SnapshotRow): PublishedAppointmentEstimate | null {
  if (!row.published_consultation_from || !row.published_consultation_to ||
      !row.published_confidence || !row.published_at) return null;
  return {
    consultationFrom: row.published_consultation_from.toISOString(),
    consultationTo: row.published_consultation_to.toISOString(),
    recommendedArrival: row.published_recommended_arrival?.toISOString() ?? null,
    arrivalAdvice: row.published_arrival_advice ?? 'arrive_at_time',
    confidence: row.published_confidence,
    version: Number(row.published_version),
    publishedAt: row.published_at.toISOString(),
  };
}

function publicEstimate(raw: RawEstimate) {
  return {
    consultationFrom: raw.consultationFrom,
    consultationTo: raw.consultationTo,
    recommendedArrival: raw.recommendedArrival,
    arrivalAdvice: raw.arrivalAdvice,
    confidence: raw.confidence,
  };
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const roundToFive = (value: Date) =>
  new Date(Math.ceil(value.getTime() / 300_000) * 300_000);

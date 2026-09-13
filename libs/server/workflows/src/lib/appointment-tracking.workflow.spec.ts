import {
  AppointmentStatus,
  ClinicSessionStatus,
  DoctorPresence,
  EstimateConfidence,
  EstimateUnavailableReason,
} from '@clinic/contracts';
import {
  calculateEstimate,
  type CalculateEstimateInput,
} from './appointment-tracking.workflow';

const base = (): CalculateEstimateInput => ({
  now: new Date('2026-09-13T10:00:00.000Z'),
  appointmentStatus: AppointmentStatus.Confirmed,
  windowStart: new Date('2026-09-13T11:00:00.000Z'),
  plannedStart: new Date('2026-09-13T10:30:00.000Z'),
  sessionStatus: ClinicSessionStatus.Scheduled,
  doctorPresence: DoctorPresence.Expected,
  expectedStartAt: null,
  doctorArrivedAt: null,
  expectedResumeAt: null,
  lastTimingChangeAt: null,
  activeQueueCount: 0,
  confirmedAheadCount: 0,
  requestedAheadCount: 0,
  baselineMinutes: 15,
  baselineValidated: true,
  baselineSource: 'clinic_configured',
  currentPaceSamples: [],
  policy: { arrivalBufferMinutes: 15, earlyCheckInMinutes: 30 },
});

describe('appointment tracking estimator', () => {
  it('allows the recommendation before the booking window within policy', () => {
    const result = calculateEstimate({
      ...base(),
      plannedStart: new Date('2026-09-13T11:05:00.000Z'),
      windowStart: new Date('2026-09-13T11:00:00.000Z'),
    });
    expect(result.raw?.consultationFrom).toBe('2026-09-13T11:05:00.000Z');
    expect(result.raw?.recommendedArrival).toBe('2026-09-13T10:50:00.000Z');
  });

  it('never recommends earlier than the allowed early boundary', () => {
    const result = calculateEstimate({
      ...base(),
      plannedStart: new Date('2026-09-13T09:00:00.000Z'),
      expectedStartAt: new Date('2026-09-13T09:00:00.000Z'),
      windowStart: new Date('2026-09-13T11:00:00.000Z'),
    });
    expect(result.raw?.recommendedArrival).toBe('2026-09-13T10:30:00.000Z');
  });

  it('does not add requested appointments to the consultation cursor', () => {
    const withoutRequests = calculateEstimate(base());
    const withRequests = calculateEstimate({
      ...base(),
      requestedAheadCount: 5,
    });
    expect(withRequests.raw?.consultationFrom).toBe(
      withoutRequests.raw?.consultationFrom,
    );
    expect(withRequests.raw?.confidence).toBe(EstimateConfidence.Low);
  });

  it('withholds estimates for a requested target', () => {
    const result = calculateEstimate({
      ...base(),
      appointmentStatus: AppointmentStatus.Requested,
    });
    expect(result.raw).toBeNull();
    expect(result.unavailableReason).toBe(
      EstimateUnavailableReason.PendingApproval,
    );
  });

  it('stops using planned start after it passes while the doctor has no ETA', () => {
    const result = calculateEstimate({
      ...base(),
      now: new Date('2026-09-13T12:00:00.000Z'),
      plannedStart: new Date('2026-09-13T11:00:00.000Z'),
    });
    expect(result.raw).toBeNull();
    expect(result.unavailableReason).toBe(
      EstimateUnavailableReason.DoctorStartUnknown,
    );
  });

  it('resumes from a later doctor ETA', () => {
    const result = calculateEstimate({
      ...base(),
      now: new Date('2026-09-13T12:00:00.000Z'),
      plannedStart: new Date('2026-09-13T11:00:00.000Z'),
      expectedStartAt: new Date('2026-09-13T12:30:00.000Z'),
    });
    expect(result.raw?.consultationFrom).toBe('2026-09-13T12:30:00.000Z');
  });

  it('requires an expected resume while paused', () => {
    const result = calculateEstimate({
      ...base(),
      sessionStatus: ClinicSessionStatus.Paused,
    });
    expect(result.unavailableReason).toBe(
      EstimateUnavailableReason.ResumeTimeUnknown,
    );
  });

  it('can reach high confidence only with stable live samples', () => {
    const result = calculateEstimate({
      ...base(),
      sessionStatus: ClinicSessionStatus.Open,
      doctorPresence: DoctorPresence.Arrived,
      doctorArrivedAt: new Date('2026-09-13T10:00:00.000Z'),
      currentPaceSamples: [14, 15, 16],
    });
    expect(result.raw?.confidence).toBe(EstimateConfidence.High);
  });
});

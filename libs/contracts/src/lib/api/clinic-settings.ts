import type { ClinicMemberRole } from '../domain/clinic-member-role';

export interface ClinicSettings {
  profile: {
    name: string;
    phoneE164: string | null;
    address: string | null;
    instapayHandle: string | null;
    timezone: string;
  };
  policies: {
    gracePeriodMinutes: number;
    defaultAvgConsultMinutes: number;
    maxSelfDefers: number;
    minLeadMinutes: number;
    cancellationCutoffMinutes: number;
    autoConfirmParentBookings: boolean;
  };
  tracking: {
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
    baselineValidatedAt: string | null;
    parentEstimateApprovedAt: string | null;
  };
  prices: Array<{
    visitType: string;
    amountMinor: number;
    currency: string;
    active: boolean;
  }>;
  templates: Array<{ key: string; body: string; active: boolean }>;
  schedules: Array<{
    id: string;
    doctorMemberId: string;
    weekday: number;
    sessionKind: string;
    startsAt: string;
    endsAt: string;
    windowMinutes: number;
    capacityPerWindow: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    active: boolean;
  }>;
  closures: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    doctorMemberId: string | null;
  }>;
  team: Array<{
    id: string;
    displayName: string;
    role: ClinicMemberRole;
    status: 'active' | 'suspended';
  }>;
}
export interface ClinicAuditEvent {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

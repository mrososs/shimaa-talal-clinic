import type { ApiClient } from '@clinic/api-client';
import type {
  Appointment,
  AvailabilityDay,
  ClinicMeResponse,
  Guardian,
  GuardianChild,
  IssuedClaimCode,
  Paginated,
  VisitType,
} from '@clinic/contracts';

/**
 * The staff endpoints, typed.
 *
 * One function per route. The paths live here and nowhere else, so a screen
 * never spells one out and the API client stays generic. No `clinicId` appears
 * in any of them: the server takes it from the token, which is what makes one
 * clinic unable to reach another's families.
 */

export interface GuardianDetail {
  guardian: Guardian;
  children: GuardianChild[];
}

export interface StaffBookingInput {
  guardianId: string;
  childId: string;
  sessionId: string;
  windowStart: string;
  visitType: VisitType;
  notes?: string;
}

export function createClinicApi(client: ApiClient) {
  return {
    me: (): Promise<ClinicMeResponse> =>
      client.get<ClinicMeResponse>('clinic/me'),

    // --- families -------------------------------------------------------

    /** Phone in any local format; the server normalises it. */
    searchGuardians: (query: {
      phone?: string;
      q?: string;
    }): Promise<Paginated<Guardian>> =>
      client.get<Paginated<Guardian>>('clinic/guardians', { query }),

    guardian: (id: string): Promise<GuardianDetail> =>
      client.get<GuardianDetail>(`clinic/guardians/${id}`),

    createGuardian: (input: {
      fullName: string;
      phone: string;
      relationship?: string;
    }): Promise<Guardian> => client.post<Guardian>('clinic/guardians', input),

    createChild: (
      guardianId: string,
      input: { fullName: string; dateOfBirth?: string; sex?: string },
    ): Promise<GuardianChild> =>
      client.post<GuardianChild>(`clinic/guardians/${guardianId}/children`, input),

    issueClaimCode: (guardianId: string): Promise<IssuedClaimCode> =>
      client.post<IssuedClaimCode>(`clinic/guardians/${guardianId}/claim-code`),

    // --- the day --------------------------------------------------------

    availability: (range?: {
      date?: string;
      to?: string;
    }): Promise<AvailabilityDay[]> =>
      client.get<AvailabilityDay[]>('clinic/availability', { query: range }),

    appointments: (date?: string): Promise<Appointment[]> =>
      client.get<Appointment[]>('clinic/appointments', { query: { date } }),

    book: (input: StaffBookingInput): Promise<Appointment> =>
      client.post<Appointment>('clinic/appointments', input),

    approve: (id: string): Promise<Appointment> =>
      client.post<Appointment>(`clinic/appointments/${id}/approve`),

    reject: (id: string, reason?: string): Promise<Appointment> =>
      client.post<Appointment>(`clinic/appointments/${id}/reject`, { reason }),

    cancel: (id: string, reason?: string): Promise<Appointment> =>
      client.post<Appointment>(`clinic/appointments/${id}/cancel`, { reason }),

    markNoShow: (id: string): Promise<Appointment> =>
      client.post<Appointment>(`clinic/appointments/${id}/no-show`),
  };
}

export type ClinicApi = ReturnType<typeof createClinicApi>;

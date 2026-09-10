import type { ApiClient } from '@clinic/api-client';
import type {
  Appointment,
  AppointmentListItem,
  AvailabilityDay,
  ClinicMeResponse,
  ClinicalEncounter,
  ClinicalMeasurement,
  ClinicalRecord,
  CreateClinicalMeasurementInput,
  DashboardSummary,
  Guardian,
  GuardianChild,
  GuardianRelationship,
  GuardianDetail,
  IssuedClaimCode,
  PatientFile,
  PatientFileDownload,
  Paginated,
  SaveClinicalEncounterInput,
  StaffFamilyRecord,
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
      page?: number;
      pageSize?: number;
    }): Promise<Paginated<Guardian>> =>
      client.get<Paginated<Guardian>>('clinic/guardians', { query }),

    guardian: (id: string): Promise<GuardianDetail> =>
      client.get<GuardianDetail>(`clinic/guardians/${id}`),

    familyRecord: (id: string): Promise<StaffFamilyRecord> =>
      client.get<StaffFamilyRecord>(`clinic/guardians/${id}/record`),

    createGuardian: (input: {
      fullName: string;
      phone: string;
      relationship?: string;
    }): Promise<Guardian> => client.post<Guardian>('clinic/guardians', input),

    createChild: (
      guardianId: string,
      input: {
        fullName: string;
        dateOfBirth?: string;
        sex?: string;
        relationship?: GuardianRelationship;
        isPrimary?: boolean;
      },
    ): Promise<GuardianChild> =>
      client.post<GuardianChild>(
        `clinic/guardians/${guardianId}/children`,
        input,
      ),

    issueClaimCode: (guardianId: string): Promise<IssuedClaimCode> =>
      client.post<IssuedClaimCode>(`clinic/guardians/${guardianId}/claim-code`),

    patientFiles: (childId: string): Promise<PatientFile[]> =>
      client.get<PatientFile[]>(`clinic/children/${childId}/files`),

    uploadPatientFile: (childId: string, file: File): Promise<PatientFile> => {
      const body = new FormData();
      body.append('file', file);
      return client.post<PatientFile>(`clinic/children/${childId}/files`, body);
    },

    patientFileDownload: (
      childId: string,
      fileId: string,
    ): Promise<PatientFileDownload> =>
      client.get<PatientFileDownload>(
        `clinic/children/${childId}/files/${fileId}/download`,
      ),

    clinicalRecord: (appointmentId: string): Promise<ClinicalRecord> =>
      client.get<ClinicalRecord>(
        `clinic/appointments/${appointmentId}/clinical-record`,
      ),

    saveClinicalDraft: (
      appointmentId: string,
      input: SaveClinicalEncounterInput,
    ): Promise<ClinicalEncounter> =>
      client.put<ClinicalEncounter>(
        `clinic/appointments/${appointmentId}/clinical-record/draft`,
        input,
      ),

    finalizeClinicalEncounter: (
      appointmentId: string,
      input: SaveClinicalEncounterInput,
    ): Promise<ClinicalEncounter> =>
      client.post<ClinicalEncounter>(
        `clinic/appointments/${appointmentId}/clinical-record/finalize`,
        input,
      ),

    measurements: (childId: string): Promise<ClinicalMeasurement[]> =>
      client.get<ClinicalMeasurement[]>(
        `clinic/children/${childId}/measurements`,
      ),

    addMeasurement: (
      childId: string,
      input: CreateClinicalMeasurementInput,
    ): Promise<ClinicalMeasurement> =>
      client.post<ClinicalMeasurement>(
        `clinic/children/${childId}/measurements`,
        input,
      ),

    // --- the day --------------------------------------------------------

    availability: (range?: {
      date?: string;
      to?: string;
    }): Promise<AvailabilityDay[]> =>
      client.get<AvailabilityDay[]>('clinic/availability', { query: range }),

    appointments: (
      date?: string,
      to?: string,
    ): Promise<AppointmentListItem[]> =>
      client.get<AppointmentListItem[]>('clinic/appointments', {
        query: { date, to },
      }),

    dashboardSummary: (date?: string): Promise<DashboardSummary> =>
      client.get<DashboardSummary>('clinic/dashboard/summary', {
        query: { date },
      }),

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

    reschedule: (
      id: string,
      target: { sessionId: string; windowStart: string },
    ): Promise<Appointment> =>
      client.post<Appointment>(`clinic/appointments/${id}/reschedule`, target),
  };
}

export type ClinicApi = ReturnType<typeof createClinicApi>;

import type { ApiClient } from '@clinic/api-client';
import type {
  Appointment,
  AvailabilityDay,
  VisitType,
  RescheduledAppointment,
  AppointmentTrackingView,
  AttendanceIntent,
} from '@clinic/contracts';

/**
 * The booking endpoints, typed.
 *
 * Thin on purpose: one function per route, no caching, no state. The paths live
 * here and nowhere else, so a screen never spells one out.
 */

export interface BookInput {
  childId: string;
  sessionId: string;
  /** Exactly as availability reported it. */
  windowStart: string;
  visitType: VisitType;
  notes?: string;
}

export function createBookingApi(client: ApiClient) {
  return {
    /**
     * Windows the clinic can still take.
     *
     * Advisory: the count is true when it was computed, and a booking can lose
     * the race for the last seat. The confirm step handles that conflict.
     */
    availability: (range?: {
      date?: string;
      to?: string;
    }): Promise<AvailabilityDay[]> =>
      client.get<AvailabilityDay[]>('booking/availability', {
        query: { date: range?.date, to: range?.to },
      }),

    book: (input: BookInput): Promise<Appointment> =>
      client.post<Appointment>('appointments', input),

    list: (scope: 'upcoming' | 'past'): Promise<Appointment[]> =>
      client.get<Appointment[]>('appointments', { query: { scope } }),

    detail: (id: string): Promise<Appointment> =>
      client.get<Appointment>(`appointments/${id}`),

    tracking: (id: string): Promise<AppointmentTrackingView> =>
      client.get<AppointmentTrackingView>(`appointments/${id}/tracking`),

    attendance: (
      id: string,
      intent: typeof AttendanceIntent.Coming | typeof AttendanceIntent.NotComing,
    ): Promise<AppointmentTrackingView> =>
      client.post<AppointmentTrackingView>(`appointments/${id}/attendance`, {
        intent,
      }),

    guestTracking: (token: string): Promise<AppointmentTrackingView> =>
      client.get<AppointmentTrackingView>('tracking/guest', {
        headers: { 'x-tracking-token': token },
      }),

    guestAttendance: (
      token: string,
      intent: typeof AttendanceIntent.Coming | typeof AttendanceIntent.NotComing,
    ): Promise<AppointmentTrackingView> =>
      client.post<AppointmentTrackingView>('tracking/guest/attendance',
        { intent },
        { headers: { 'x-tracking-token': token } },
      ),

    cancel: (id: string, reason?: string): Promise<Appointment> =>
      client.post<Appointment>(`appointments/${id}/cancel`, { reason }),

    reschedule: (
      id: string,
      target: { sessionId: string; windowStart: string },
    ): Promise<RescheduledAppointment> =>
      client.post<RescheduledAppointment>(`appointments/${id}/reschedule`, target),
  };
}

export type BookingApi = ReturnType<typeof createBookingApi>;

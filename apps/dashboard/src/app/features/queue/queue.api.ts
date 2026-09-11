import type { ApiClient } from '@clinic/api-client';
import type {
  ClinicSession,
  DoctorPresence,
  QueueBoardResponse,
  QueueEntry,
  QueueGuestLink,
} from '@clinic/contracts';

export interface WalkInInput {
  childId: string;
  guardianId: string;
  visitReason?: string;
}

/**
 * The queue endpoints, typed.
 *
 * One function per route, and the paths live here and nowhere else. No
 * `clinicId` appears in any of them: the server takes it from the token, which
 * is what makes one clinic unable to reach another's day.
 *
 * Every command is named after what staff are doing, not after a field it
 * happens to change. There is deliberately no `setStatus`.
 */
export function createQueueApi(client: ApiClient) {
  return {
    // --- the day --------------------------------------------------------

    /** Today's sessions, materialised from the schedule if nobody has asked yet. */
    sessions: (date?: string): Promise<ClinicSession[]> =>
      client.get<ClinicSession[]>('clinic/sessions', { query: { date } }),

    openSession: (id: string): Promise<ClinicSession> =>
      client.post<ClinicSession>(`clinic/sessions/${id}/open`),

    pauseSession: (id: string): Promise<ClinicSession> =>
      client.post<ClinicSession>(`clinic/sessions/${id}/pause`),

    resumeSession: (id: string): Promise<ClinicSession> =>
      client.post<ClinicSession>(`clinic/sessions/${id}/resume`),

    closeSession: (id: string): Promise<ClinicSession> =>
      client.post<ClinicSession>(`clinic/sessions/${id}/close`),

    setPresence: (
      id: string,
      input: { presence: DoctorPresence; delayMinutes?: number; note?: string },
    ): Promise<ClinicSession> =>
      client.post<ClinicSession>(
        `clinic/sessions/${id}/doctor-presence`,
        input,
      ),

    setPace: (id: string, avgConsultMinutes: number): Promise<ClinicSession> =>
      client.patch<ClinicSession>(`clinic/sessions/${id}/pace`, {
        avgConsultMinutes,
      }),

    // --- the board ------------------------------------------------------

    /**
     * The board, or two numbers saying it has not moved.
     *
     * `since` is the revision the caller already holds. Omit it after a
     * reconnect: coming back with a stale revision would be answered
     * "unchanged" against a board that has moved on.
     */
    board: (sessionId: string, since?: number): Promise<QueueBoardResponse> =>
      client.get<QueueBoardResponse>('clinic/queue', {
        query: { sessionId, since },
      }),

    // --- commands -------------------------------------------------------

    checkIn: (appointmentId: string): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/appointments/${appointmentId}/check-in`),

    walkIn: (input: WalkInInput & { sessionId: string }): Promise<QueueEntry> =>
      client.post<QueueEntry>('clinic/queue/walk-in', input),

    callNext: (sessionId: string): Promise<QueueEntry | null> =>
      client.post<QueueEntry | null>('clinic/queue/call-next', { sessionId }),

    completeAndCallNext: (sessionId: string): Promise<QueueEntry | null> =>
      client.post<QueueEntry | null>('clinic/queue/complete-and-call-next', {
        sessionId,
      }),

    call: (entryId: string): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/call`),

    start: (entryId: string): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/start`),

    complete: (entryId: string): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/complete`),

    createGuestLink: (entryId: string): Promise<QueueGuestLink> =>
      client.post<QueueGuestLink>(`clinic/queue/${entryId}/guest-link`),

    revokeGuestLink: (entryId: string): Promise<{ revoked: true }> =>
      client.delete<{ revoked: true }>(`clinic/queue/${entryId}/guest-link`),

    /** `force` skips a grace period that has not run out, and needs a reason. */
    miss: (
      entryId: string,
      options: { force?: boolean; reason?: string } = {},
    ): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/miss`, options),

    requeue: (entryId: string): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/requeue`),

    cancelEntry: (entryId: string, reason?: string): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/cancel`, { reason }),

    /** Reversible, and marking one always carries a reason. */
    setEmergency: (
      entryId: string,
      emergency: boolean,
      reason?: string,
    ): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/emergency`, {
        emergency,
        reason,
      }),

    /** Between two neighbours. The server takes their midpoint. */
    move: (
      entryId: string,
      between: { beforeEntryId?: string; afterEntryId?: string },
    ): Promise<QueueEntry> =>
      client.post<QueueEntry>(`clinic/queue/${entryId}/move`, between),
  };
}

export type QueueApi = ReturnType<typeof createQueueApi>;

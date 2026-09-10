import type { ApiClient } from '@clinic/api-client';
import type {
  AcceptUrgentCaseResult,
  MessageInbox,
  MessageInboxFilter,
  MessageThreadDetail,
  MessageThreadSummary,
  ThreadMessage,
  UrgentCaseSummary,
} from '@clinic/contracts';

export function createMessagesApi(client: ApiClient) {
  return {
    inbox: (filter: MessageInboxFilter): Promise<MessageInbox> =>
      client.get<MessageInbox>('clinic/messages', { query: { filter } }),
    detail: (threadId: string): Promise<MessageThreadDetail> =>
      client.get<MessageThreadDetail>(`clinic/messages/${threadId}`),
    reply: (threadId: string, body: string, clientRequestId: string): Promise<ThreadMessage> =>
      client.post<ThreadMessage>(`clinic/messages/${threadId}/replies`, { body, clientRequestId }),
    markRead: (threadId: string): Promise<void> =>
      client.post<void>(`clinic/messages/${threadId}/read`),
    assignToDoctor: (threadId: string): Promise<MessageThreadSummary> =>
      client.post<MessageThreadSummary>(`clinic/messages/${threadId}/assign-to-doctor`),
    close: (threadId: string): Promise<MessageThreadSummary> =>
      client.post<MessageThreadSummary>(`clinic/messages/${threadId}/close`),
    reopen: (threadId: string): Promise<MessageThreadSummary> =>
      client.post<MessageThreadSummary>(`clinic/messages/${threadId}/reopen`),
    raiseUrgent: (threadId: string, triageNote: string): Promise<UrgentCaseSummary> =>
      client.post<UrgentCaseSummary>(`clinic/messages/${threadId}/urgent`, { triageNote }),
    rejectUrgent: (caseId: string, decisionNote?: string): Promise<UrgentCaseSummary> =>
      client.post<UrgentCaseSummary>(`clinic/messages/urgent-cases/${caseId}/reject`, { decisionNote }),
    acceptUrgent: (caseId: string, sessionId: string, decisionNote?: string): Promise<AcceptUrgentCaseResult> =>
      client.post<AcceptUrgentCaseResult>(`clinic/messages/urgent-cases/${caseId}/accept`, { sessionId, decisionNote }),
  };
}

export type MessagesApi = ReturnType<typeof createMessagesApi>;

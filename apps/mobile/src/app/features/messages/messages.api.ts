import type { ApiClient } from '@clinic/api-client';
import type {
  CreateParentMessageThreadInput,
  MessageThreadDetail,
  ParentMessageInbox,
  ThreadMessage,
  UrgentCaseSummary,
} from '@clinic/contracts';

export function createParentMessagesApi(client: ApiClient) {
  return {
    inbox: (): Promise<ParentMessageInbox> =>
      client.get<ParentMessageInbox>('messages'),

    create: (
      input: CreateParentMessageThreadInput,
    ): Promise<MessageThreadDetail> =>
      client.post<MessageThreadDetail>('messages', input),

    detail: (threadId: string): Promise<MessageThreadDetail> =>
      client.get<MessageThreadDetail>(`messages/${threadId}`),

    reply: (
      threadId: string,
      body: string,
      clientRequestId: string,
    ): Promise<ThreadMessage> =>
      client.post<ThreadMessage>(`messages/${threadId}/replies`, {
        body,
        clientRequestId,
      }),

    markRead: (threadId: string): Promise<void> =>
      client.post<void>(`messages/${threadId}/read`),

    raiseUrgent: (
      threadId: string,
      triageNote: string,
    ): Promise<UrgentCaseSummary> =>
      client.post<UrgentCaseSummary>(`messages/${threadId}/urgent`, {
        triageNote,
      }),
  };
}

export type ParentMessagesApi = ReturnType<typeof createParentMessagesApi>;

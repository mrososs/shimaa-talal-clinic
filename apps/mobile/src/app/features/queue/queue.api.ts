import type { ApiClient } from '@clinic/api-client';
import type {
  GuestQueueView,
  ParentQueueEntry,
  ParentQueueResponse,
} from '@clinic/contracts';

/**
 * The one queue endpoint this app reads.
 *
 * There is no clinic board here and there never will be: `GET /queue/me`
 * answers for the signed-in guardian's own children, and the response has
 * nowhere to put anybody else's.
 */
export function createQueueApi(client: ApiClient) {
  return {
    /**
     * This family's turns, or two numbers saying nothing has moved.
     *
     * `since` is the revision the app already holds. Omit it after the app has
     * been in the background — coming back with a ten-minute-old revision would
     * be answered "unchanged" against a queue that moved on without them.
     */
    mine: (since?: number): Promise<ParentQueueResponse> =>
      client.get<ParentQueueResponse>('queue/me', { query: { since } }),

    /** Anonymous capability view. The token is the authority. */
    guest: (token: string): Promise<GuestQueueView> =>
      client.get<GuestQueueView>(`queue/guest/${encodeURIComponent(token)}`),

    /**
     * "Let the next person go."
     *
     * The only write a parent makes into the queue. The clinic's own limit
     * decides how often, and the server refuses past it — this does not
     * pre-empt that decision, it just asks.
     */
    defer: (entryId: string): Promise<ParentQueueEntry> =>
      client.post<ParentQueueEntry>(`queue/${entryId}/defer`),
  };
}

export type QueueApi = ReturnType<typeof createQueueApi>;

import type { ApiClient } from '@clinic/api-client';
import type { ParentQueueResponse } from '@clinic/contracts';

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
  };
}

export type QueueApi = ReturnType<typeof createQueueApi>;

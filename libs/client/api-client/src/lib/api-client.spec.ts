import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from './api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  /**
   * The client is the only place every request passes through, so it is the
   * only place that can notice the token has stopped working. Features used to
   * each catch their own error and, separately, decide to carry on polling.
   */
  describe('onUnauthenticated', () => {
    const failing = (status: number) =>
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          jsonResponse(
            { success: false, error: { code: 'denied', message: 'no' } },
            status,
          ),
        );

    it('reports a 401', async () => {
      const onUnauthenticated = vi.fn();
      const client = new ApiClient({
        baseUrl: 'https://api.example.test/api/v1',
        fetchImpl: failing(401),
        onUnauthenticated,
      });

      await expect(client.get('/things')).rejects.toBeInstanceOf(
        ApiClientError,
      );
      expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    });

    it('stays quiet on a 403', async () => {
      // Authenticated, and simply not allowed. Ending the session here would
      // sign a doctor out for opening a reception-only screen.
      const onUnauthenticated = vi.fn();
      const client = new ApiClient({
        baseUrl: 'https://api.example.test/api/v1',
        fetchImpl: failing(403),
        onUnauthenticated,
      });

      await expect(client.get('/things')).rejects.toBeInstanceOf(
        ApiClientError,
      );
      expect(onUnauthenticated).not.toHaveBeenCalled();
    });

    it('stays quiet on every other failure', async () => {
      const onUnauthenticated = vi.fn();
      for (const status of [400, 404, 409, 500]) {
        const client = new ApiClient({
          baseUrl: 'https://api.example.test/api/v1',
          fetchImpl: failing(status),
          onUnauthenticated,
        });
        await expect(client.get('/things')).rejects.toBeInstanceOf(
          ApiClientError,
        );
      }
      expect(onUnauthenticated).not.toHaveBeenCalled();
    });
  });

  it('unwraps the shared ApiResponse envelope and attaches the bearer token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ success: true, data: { id: 'a1' } }));

    const client = new ApiClient({
      baseUrl: 'https://api.example.test/api/v1/',
      getAccessToken: () => 'token-123',
      fetchImpl,
    });

    await expect(
      client.get('/things', { query: { page: 2 } }),
    ).resolves.toEqual({ id: 'a1' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/v1/things?page=2');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer token-123',
    );
  });

  it('turns a failure envelope into an ApiClientError', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: { code: 'not_found', message: 'Missing' } },
          404,
        ),
      );

    const client = new ApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetchImpl,
    });

    await expect(client.get('things/1')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 404,
      error: { code: 'not_found' },
    });
    await expect(client.get('things/1')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('sends FormData without overriding the browser multipart boundary', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ success: true, data: { id: 'file-1' } }),
      );
    const client = new ApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      fetchImpl,
    });
    const body = new FormData();
    body.append('file', new Blob(['scan'], { type: 'image/png' }), 'scan.png');

    await client.post('clinic/children/child-1/files', body);

    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.body).toBe(body);
    expect(
      (init?.headers as Record<string, string>)['Content-Type'],
    ).toBeUndefined();
  });
});

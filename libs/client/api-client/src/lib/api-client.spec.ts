import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiClientError } from './api-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
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

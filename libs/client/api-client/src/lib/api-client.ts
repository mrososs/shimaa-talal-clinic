import {
  isApiSuccess,
  type ApiErrorBody,
  type ApiResponse,
} from '@clinic/contracts';

/**
 * The single HTTP seam between the frontends and the NestJS API.
 *
 * Feature code must not call `fetch` directly. It calls a typed method on this
 * client, which owns the base URL, the auth header, the response envelope and
 * the error shape. No booking/queue/payment endpoints exist yet — those arrive
 * with their domains.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type AccessTokenProvider = () => string | null | Promise<string | null>;

export interface ApiClientOptions {
  /** Absolute base URL including the version segment, e.g. `/api/v1`. */
  baseUrl: string;
  /** Supplies the bearer token for authenticated calls. */
  getAccessToken?: AccessTokenProvider;
  /** Injected for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Thrown for any non-2xx response, or a 2xx carrying an `ApiFailure`. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiErrorBody,
  ) {
    super(error.message);
    this.name = 'ApiClientError';
  }
}

const UNKNOWN_ERROR: ApiErrorBody = {
  code: 'unknown_error',
  message: 'The API returned an unreadable response.',
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    // Normalised once so callers can pass paths with or without a leading slash.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  /**
   * Unwraps the shared `ApiResponse` envelope, so callers work with `T` and
   * catch `ApiClientError` instead of branching on `success` everywhere.
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const formData = isFormData(body);
    const response = await this.fetchImpl(this.buildUrl(path, options?.query), {
      method,
      headers: await this.buildHeaders(
        body !== undefined,
        formData,
        options?.headers,
      ),
      body:
        body === undefined ? undefined : formData ? body : JSON.stringify(body),
      signal: options?.signal,
    });

    const payload = await this.readBody<T>(response);

    if (!response.ok) {
      throw new ApiClientError(
        response.status,
        payload && !isApiSuccess(payload) ? payload.error : UNKNOWN_ERROR,
      );
    }

    if (payload === null) {
      throw new ApiClientError(response.status, UNKNOWN_ERROR);
    }

    if (!isApiSuccess(payload)) {
      throw new ApiClientError(response.status, payload.error);
    }

    return payload.data;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}`;

    if (!query) {
      return url;
    }

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }

    const serialized = params.toString();
    return serialized ? `${url}?${serialized}` : url;
  }

  private async buildHeaders(
    hasBody: boolean,
    isMultipart: boolean,
    extra?: Record<string, string>,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.options.defaultHeaders,
      ...extra,
    };

    if (hasBody && !isMultipart) {
      headers['Content-Type'] = 'application/json';
    }

    const token = await this.options.getAccessToken?.();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  private async readBody<T>(
    response: Response,
  ): Promise<ApiResponse<T> | null> {
    if (response.status === 204) {
      return { success: true, data: undefined as T };
    }

    try {
      return (await response.json()) as ApiResponse<T>;
    } catch {
      return null;
    }
  }
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}

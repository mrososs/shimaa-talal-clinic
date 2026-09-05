/**
 * One pagination shape for the whole platform, so list endpoints do not each
 * invent their own.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** What a client sends. Pages are 1-based. */
export interface PageRequest {
  page: number;
  pageSize: number;
}

/** What the API reports back alongside a page of items. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/**
 * Clamps untrusted paging input into the supported range.
 * Pure and dependency-free so both the API and the clients can use it.
 */
export function normalizePageRequest(
  input: Partial<PageRequest> | undefined,
): PageRequest {
  const page = Math.max(1, Math.trunc(input?.page ?? 1) || 1);
  const requestedSize = Math.trunc(input?.pageSize ?? DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, requestedSize || DEFAULT_PAGE_SIZE),
  );

  return { page, pageSize };
}

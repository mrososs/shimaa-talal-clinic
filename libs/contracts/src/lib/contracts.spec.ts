import { describe, expect, it } from 'vitest';
import {
  API_BASE_PATH,
  ApiCommand,
  ApiResource,
  ClinicMemberRole,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  QueueStatus,
  UserRole,
  isApiSuccess,
  isUnchanged,
  normalizePageRequest,
  type ApiResponse,
  type ParentQueueResponse,
  type QueueBoardResponse,
  type UserRole as UserRoleType,
} from '../index';

/**
 * Architecture-level smoke tests for the shared contracts.
 * These guard the few pieces of real behaviour the library carries — not the
 * type declarations, which the compiler already checks.
 */
describe('@clinic/contracts', () => {
  it('exposes the API base path both sides agree on', () => {
    expect(API_BASE_PATH).toBe('/api/v1');
  });

  it('narrows an ApiResponse through isApiSuccess', () => {
    const ok: ApiResponse<number> = { success: true, data: 42 };
    const failed: ApiResponse<number> = {
      success: false,
      error: { code: 'nope', message: 'not today' },
    };

    expect(isApiSuccess(ok)).toBe(true);
    expect(isApiSuccess(failed)).toBe(false);

    if (isApiSuccess(ok)) {
      // Compiles only because the guard narrowed the union.
      expect(ok.data).toBe(42);
    }
  });

  describe('normalizePageRequest', () => {
    it('applies defaults for missing input', () => {
      expect(normalizePageRequest(undefined)).toEqual({
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
      });
    });

    it('clamps out-of-range values instead of trusting the caller', () => {
      expect(normalizePageRequest({ page: -3, pageSize: 5_000 })).toEqual({
        page: 1,
        pageSize: MAX_PAGE_SIZE,
      });
    });
  });
  describe('ClinicMemberRole', () => {
    it('reuses the UserRole strings rather than redeclaring them', () => {
      // Two literal lists would drift, and the drift would only show up as an
      // authorisation bug against a role the database actually stores.
      expect(ClinicMemberRole.Doctor).toBe(UserRole.Doctor);
      expect(ClinicMemberRole.Reception).toBe(UserRole.Reception);
      expect(ClinicMemberRole.Admin).toBe(UserRole.Admin);
    });

    it('is the staff subset — a guardian is never a clinic member', () => {
      expect(Object.values(ClinicMemberRole)).not.toContain(UserRole.Guardian);
    });

    it('is assignable to UserRole', () => {
      // Compiles only because ClinicMemberRole is derived from UserRole.
      const role: UserRoleType = ClinicMemberRole.Doctor;
      expect(role).toBe('doctor');
    });
  });

  describe('QueueStatus', () => {
    it('has no state for grace, arrival, lateness or urgency', () => {
      // Each of those is derived, presentational or orthogonal. Persisting them
      // would mean the same fact stored in two places, disagreeing.
      const values: string[] = Object.values(QueueStatus);
      for (const notAState of ['grace_period', 'arrived', 'late', 'urgent']) {
        expect(values).not.toContain(notAState);
      }
    });

    it('can express an entry removed from the queue', () => {
      expect(QueueStatus.Cancelled).toBe('cancelled');
    });
  });

  describe('isUnchanged', () => {
    it('narrows an unchanged poll away from a board', () => {
      const unchanged: QueueBoardResponse = { changed: false, revision: 187 };
      expect(isUnchanged(unchanged)).toBe(true);
      if (isUnchanged(unchanged)) {
        // Compiles only because the guard narrowed the union.
        expect(unchanged.revision).toBe(187);
      }
    });

    it('lets a populated parent view through', () => {
      const view: ParentQueueResponse = { items: [], revision: 1 };
      expect(isUnchanged(view)).toBe(false);
    });
  });

  describe('route segments', () => {
    it('keeps segments URL-safe, since both sides build paths from them', () => {
      const segments = [
        ...Object.values(ApiResource),
        ...Object.values(ApiCommand),
      ];
      for (const segment of segments) {
        expect(segment).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it('does not collide on a command name', () => {
      const values = Object.values(ApiCommand);
      expect(new Set(values).size).toBe(values.length);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { routes } from './index';

/**
 * Architecture smoke test. It checks that the shell has exactly one route and
 * that it resolves — not what the page looks like.
 */
describe('mobile router', () => {
  it('exposes a single root route', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/');
    expect(routes[0].name).toBe('home');
    expect(routes[0].component).toBeDefined();
  });
});

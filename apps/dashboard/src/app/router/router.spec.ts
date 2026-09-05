import { describe, expect, it } from 'vitest';
import { routes } from './index';

/**
 * Architecture smoke test: the dashboard shell has exactly one route.
 */
describe('dashboard router', () => {
  it('exposes a single root route', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('/');
    expect(routes[0].name).toBe('home');
    expect(routes[0].component).toBeDefined();
  });
});

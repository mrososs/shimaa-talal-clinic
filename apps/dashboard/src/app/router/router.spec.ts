import { describe, expect, it } from 'vitest';
import { routes } from './index';
import { ROUTE_META_PUBLIC } from './auth-guard';

/**
 * The route table, checked for the properties the guard depends on.
 */
describe('dashboard router', () => {
  it('marks only the sign-in screen public', () => {
    const publicNames = routes
      .filter((route) => route.meta?.[ROUTE_META_PUBLIC] === true)
      .map((route) => route.name);

    expect(publicNames).toEqual(['sign-in']);
  });

  it('renders every staff screen inside the shell', () => {
    // The shell owns the "no clinic access" and "server unreachable" states.
    // A page mounted outside it would render neither.
    const shell = routes.find((route) => route.path === '/');
    expect(shell?.children?.map((child) => child.name)).toEqual([
      'overview',
      'appointments',
      'queue',
      'reception-booking',
    ]);
  });

  it('gives every screen a title for the shell to render', () => {
    // The top bar reads it from the route, so a screen cannot forget to name
    // itself — it would render a blank heading instead.
    const shell = routes.find((route) => route.path === '/');
    for (const child of shell?.children ?? []) {
      expect(child.meta?.['title'], String(child.name)).toBeTruthy();
    }
  });

  it('sends an unknown deep link to the overview', () => {
    const fallback = routes.at(-1);
    expect(fallback?.path).toBe('/:pathMatch(.*)*');
    expect(fallback?.redirect).toEqual({ name: 'overview' });
  });
});

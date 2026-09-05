import { describe, expect, it } from 'vitest';
import { routes } from './index';
import { ROUTE_META_ONBOARDING, ROUTE_META_PUBLIC } from './auth-guard';

/**
 * The route table, checked for the properties the guard depends on.
 *
 * The guard reads `meta`, so a route that forgets to declare itself public
 * becomes unreachable and one that forgets `onboarding` becomes a redirect
 * loop. Neither is visible in a component test.
 */
describe('mobile router', () => {
  const named = (name: string) => routes.find((route) => route.name === name);

  it('marks exactly the auth screens public', () => {
    const publicNames = routes
      .filter((route) => route.meta?.[ROUTE_META_PUBLIC] === true)
      .map((route) => route.name);

    expect(publicNames).toEqual(['sign-in', 'sign-up']);
  });

  it('marks every onboarding screen as onboarding', () => {
    const onboarding = routes
      .filter((route) => route.meta?.[ROUTE_META_ONBOARDING] === true)
      .map((route) => route.name);

    expect(onboarding).toEqual([
      'onboarding-guardian',
      'onboarding-claim',
      'onboarding-child',
    ]);
  });

  it('gives the guard every destination it can return', () => {
    for (const name of [
      'sign-in',
      'home',
      'onboarding-guardian',
      'onboarding-child',
    ]) {
      expect(named(name), name).toBeDefined();
    }
  });

  it('sends an unknown deep link home rather than to an error', () => {
    const fallback = routes.at(-1);
    expect(fallback?.path).toBe('/:pathMatch(.*)*');
    expect(fallback?.redirect).toEqual({ name: 'home' });
  });
});

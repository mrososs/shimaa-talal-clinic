import { describe, expect, it } from 'vitest';
import { routes } from './index';
import {
  ROUTE_META_ONBOARDING,
  ROUTE_META_GUEST,
  ROUTE_META_PASSWORD_RECOVERY,
  ROUTE_META_PUBLIC,
} from './auth-guard';

/**
 * The route table, checked for the properties the guard depends on.
 *
 * The guard reads `meta`, so a route that forgets to declare itself public
 * becomes unreachable and one that forgets `onboarding` becomes a redirect
 * loop. Neither is visible in a component test.
 */
describe('mobile router', () => {
  const flatten = (records: RouteRecordRaw[]): RouteRecordRaw[] =>
    records.flatMap((record) => [record, ...flatten(record.children ?? [])]);

  const allRoutes = flatten(routes);
  const named = (name: string) =>
    allRoutes.find((route) => route.name === name);

  it('marks exactly the auth screens public', () => {
    const publicNames = allRoutes
      .filter((route) => route.meta?.[ROUTE_META_PUBLIC] === true)
      .map((route) => route.name);

    expect(publicNames).toEqual(['sign-in', 'sign-up', 'reset-password']);
  });

  it('marks only anonymous tracking capabilities as guest routes', () => {
    expect(
      allRoutes
        .filter((route) => route.meta?.[ROUTE_META_GUEST] === true)
        .map((route) => route.name),
    ).toEqual(['guest-appointment-tracking', 'guest-queue']);
  });

  it('marks every onboarding screen as onboarding', () => {
    const onboarding = allRoutes
      .filter((route) => route.meta?.[ROUTE_META_ONBOARDING] === true)
      .map((route) => route.name);

    expect(onboarding).toEqual([
      'onboarding-guardian',
      'onboarding-claim',
      'onboarding-child',
    ]);
  });

  it('marks only the new-password callback as password recovery', () => {
    expect(
      allRoutes
        .filter((route) => route.meta?.[ROUTE_META_PASSWORD_RECOVERY] === true)
        .map((route) => route.name),
    ).toEqual(['update-password']);
  });

  it('gives the guard every destination it can return', () => {
    for (const name of [
      'sign-in',
      'reset-password',
      'update-password',
      'home',
      'onboarding-guardian',
      'onboarding-child',
      // Tab destinations: the tab bar routes by name, so a missing one is a
      // dead tab rather than a compile error.
      'appointments',
      'queue',
      'messages',
      'booking',
      'appointment-detail',
      'appointment-reschedule',
      'growth',
      'payments',
      'notifications',
      'assistant',
      'add-child',
      'guest-queue',
    ]) {
      expect(named(name), name).toBeDefined();
    }
  });

  it('keeps only top-level destinations inside the Ionic tabs shell', () => {
    const tabsShell = routes.find(
      (route) => route.path === '/tabs' && route.name === undefined,
    );

    expect(
      tabsShell?.children
        ?.map((route) => route.name)
        .filter((name) => name !== undefined),
    ).toEqual(['home', 'appointments', 'queue', 'messages']);
    expect(tabsShell?.children?.at(0)?.redirect).toEqual({ name: 'home' });
    expect(named('booking')).not.toBeUndefined();
    expect(tabsShell?.children).not.toContain(named('booking'));
    expect(tabsShell?.children).not.toContain(named('appointment-detail'));
    expect(tabsShell?.children).not.toContain(named('appointment-reschedule'));
    expect(tabsShell?.children).not.toContain(named('growth'));
    expect(tabsShell?.children).not.toContain(named('payments'));
    expect(tabsShell?.children).not.toContain(named('notifications'));
    expect(tabsShell?.children).not.toContain(named('assistant'));
    expect(tabsShell?.children).not.toContain(named('add-child'));
  });

  it('sends an unknown deep link home rather than to an error', () => {
    const fallback = routes.at(-1);
    expect(fallback?.path).toBe('/:pathMatch(.*)*');
    expect(fallback?.redirect).toEqual({ name: 'home' });
  });
});

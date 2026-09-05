import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { session } from '../runtime';
import {
  createAuthGuard,
  ROUTE_META_ONBOARDING,
  ROUTE_META_PUBLIC,
} from './auth-guard';

/**
 * Ionic's router wraps vue-router so that page transitions and the native-style
 * navigation stack work. Always create it from `@ionic/vue-router`, never from
 * `vue-router` directly.
 *
 * Three of these routes are tab roots — home, appointments, queue — and the
 * rest are not. The tab bar is rendered by the screen rather than by
 * `ion-tabs`, because sign-in, onboarding and the booking flow are all places
 * where a tab bar would offer a way out of a task somebody is in the middle of.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/auth/sign-in',
    name: 'sign-in',
    component: () => import('../features/auth/pages/SignInPage.vue'),
    meta: { [ROUTE_META_PUBLIC]: true },
  },
  {
    path: '/auth/sign-up',
    name: 'sign-up',
    component: () => import('../features/auth/pages/SignUpPage.vue'),
    meta: { [ROUTE_META_PUBLIC]: true },
  },
  {
    path: '/onboarding/guardian',
    name: 'onboarding-guardian',
    component: () =>
      import('../features/onboarding/pages/GuardianSetupPage.vue'),
    meta: { [ROUTE_META_ONBOARDING]: true },
  },
  {
    path: '/onboarding/claim',
    name: 'onboarding-claim',
    component: () =>
      import('../features/onboarding/pages/ClaimAccountPage.vue'),
    meta: { [ROUTE_META_ONBOARDING]: true },
  },
  {
    path: '/onboarding/child',
    name: 'onboarding-child',
    component: () => import('../features/onboarding/pages/ChildSetupPage.vue'),
    meta: { [ROUTE_META_ONBOARDING]: true },
  },

  // Tab roots.
  {
    path: '/',
    name: 'home',
    component: () => import('../features/home/pages/HomePage.vue'),
  },
  {
    path: '/appointments',
    name: 'appointments',
    component: () =>
      import('../features/appointments/pages/AppointmentsPage.vue'),
  },
  {
    path: '/queue',
    name: 'queue',
    component: () => import('../features/queue/pages/LiveQueuePage.vue'),
  },

  // Inside a task: no tabs.
  {
    path: '/booking',
    name: 'booking',
    component: () => import('../features/booking/pages/BookVisitPage.vue'),
  },
  {
    path: '/appointments/:appointmentId',
    name: 'appointment-detail',
    component: () =>
      import('../features/appointments/pages/AppointmentDetailPage.vue'),
  },

  {
    // An unknown deep link is not worth an error screen in a clinic app.
    path: '/:pathMatch(.*)*',
    redirect: { name: 'home' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/**
 * Bootstrapping is started once and awaited by every navigation.
 *
 * Not called at module scope on purpose — importing the router should not fire
 * a network request. `main.ts` starts it, and the guard awaits whatever this
 * resolves to.
 */
let bootstrapped: Promise<void> | null = null;

export function startSession(): Promise<void> {
  bootstrapped ??= session.bootstrap();
  return bootstrapped;
}

router.beforeEach(createAuthGuard({ session, ready: startSession }));

import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { session } from '../runtime';
import {
  createAuthGuard,
  ROUTE_META_ONBOARDING,
  ROUTE_META_PASSWORD_RECOVERY,
  ROUTE_META_PUBLIC,
  ROUTE_META_GUEST,
} from './auth-guard';

/**
 * Ionic's router wraps vue-router so that page transitions and the native-style
 * navigation stack work. Always create it from `@ionic/vue-router`, never from
 * `vue-router` directly.
 *
 * Home, appointments and queue live under one Ionic tabs shell, which gives
 * every tab its own native-style navigation stack. Auth, onboarding and
 * focused task routes stay outside it, so they never leak the tab bar.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/queue/guest/:token',
    name: 'guest-queue',
    component: () => import('../features/queue/pages/GuestQueuePage.vue'),
    meta: { [ROUTE_META_GUEST]: true },
  },
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
    path: '/auth/reset-password',
    name: 'reset-password',
    component: () => import('../features/auth/pages/ResetPasswordPage.vue'),
    meta: { [ROUTE_META_PUBLIC]: true },
  },
  {
    path: '/auth/update-password',
    name: 'update-password',
    component: () => import('../features/auth/pages/UpdatePasswordPage.vue'),
    meta: { [ROUTE_META_PASSWORD_RECOVERY]: true },
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

  // Preserve the original public URLs while keeping focused tasks outside the
  // tab route namespace. Redirects resolve to the canonical Ionic tab stacks.
  {
    path: '/',
    redirect: { name: 'home' },
  },
  {
    path: '/appointments',
    redirect: { name: 'appointments' },
  },
  {
    path: '/queue',
    redirect: { name: 'queue' },
  },
  {
    path: '/messages',
    redirect: { name: 'messages' },
  },

  // Top-level destinations share one real Ionic tabs shell.
  {
    path: '/tabs',
    component: () => import('../layout/MobileTabsShell.vue'),
    children: [
      {
        path: '',
        redirect: { name: 'home' },
      },
      {
        path: 'home',
        name: 'home',
        component: () => import('../features/home/pages/HomePage.vue'),
      },
      {
        path: 'appointments',
        name: 'appointments',
        component: () =>
          import('../features/appointments/pages/AppointmentsPage.vue'),
      },
      {
        path: 'queue',
        name: 'queue',
        component: () => import('../features/queue/pages/LiveQueuePage.vue'),
      },
      {
        path: 'messages',
        name: 'messages',
        component: () => import('../features/messages/pages/MessagesPage.vue'),
      },
    ],
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
    path: '/appointments/:appointmentId/reschedule',
    name: 'appointment-reschedule',
    component: () =>
      import('../features/booking/pages/RescheduleVisitPage.vue'),
  },
  {
    path: '/growth',
    name: 'growth',
    component: () => import('../features/growth/pages/GrowthPage.vue'),
  },
  {
    path: '/children/new',
    name: 'add-child',
    component: () => import('../features/onboarding/pages/ChildSetupPage.vue'),
  },
  {
    path: '/payments',
    name: 'payments',
    component: () => import('../features/payments/pages/PaymentsPage.vue'),
  },
  {
    path: '/notifications',
    name: 'notifications',
    component: () =>
      import('../features/notifications/pages/NotificationsPage.vue'),
  },
  {
    path: '/assistant',
    name: 'assistant',
    component: () =>
      import('../features/assistant/pages/FaqAssistantPage.vue'),
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

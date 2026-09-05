import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import { ClinicMemberRole } from '@clinic/contracts';
import AppShell from '../layout/AppShell.vue';
import { session } from '../runtime';
import {
  createAuthGuard,
  ROUTE_META_PUBLIC,
  ROUTE_META_ROLES,
} from './auth-guard';

/**
 * Two branches: the sign-in screen, and everything inside the shell.
 *
 * The shell is a layout route rather than a component each page imports, so the
 * top bar and the "no clinic access" state are rendered once, around the router
 * view, instead of by every screen remembering to. Each route carries the title
 * that bar shows — a screen cannot forget to name itself.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/sign-in',
    name: 'sign-in',
    component: () => import('../features/auth/pages/SignInPage.vue'),
    meta: { [ROUTE_META_PUBLIC]: true },
  },
  {
    path: '/',
    component: AppShell,
    children: [
      {
        path: '',
        name: 'overview',
        component: () => import('../features/overview/pages/OverviewPage.vue'),
        meta: { title: 'اليوم', subtitle: 'نظرة عامة على يوم العيادة' },
      },
      {
        path: 'appointments',
        name: 'appointments',
        component: () =>
          import('../features/appointments/pages/AppointmentsPage.vue'),
        meta: { title: 'المواعيد', subtitle: 'الطلبات والحجوزات' },
      },
      {
        path: 'queue',
        name: 'queue',
        component: () => import('../features/queue/pages/QueueBoardPage.vue'),
        meta: {
          title: 'الطابور المباشر',
          subtitle: 'من في العيادة الآن، ومن ينتظر',
        },
      },
      {
        path: 'booking',
        name: 'reception-booking',
        component: () =>
          import('../features/booking/pages/ReceptionBookingPage.vue'),
        meta: {
          title: 'حجز جديد',
          subtitle: 'ابحثي عن العائلة أو أنشئي ملفاً جديداً',
          [ROUTE_META_ROLES]: [
            ClinicMemberRole.Reception,
            ClinicMemberRole.Admin,
          ],
        },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'overview' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

let bootstrapped: Promise<void> | null = null;

export function startSession(): Promise<void> {
  bootstrapped ??= session.bootstrap();
  return bootstrapped;
}

router.beforeEach(createAuthGuard({ session, ready: startSession }));

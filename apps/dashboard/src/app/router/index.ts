import { watch } from 'vue';
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
        path: 'messages',
        name: 'messages',
        component: () => import('../features/messages/pages/MessagesPage.vue'),
        meta: {
          title: 'الرسائل والحالات العاجلة',
          subtitle: 'متابعة رسائل الأسر والتقييمات التي تحتاج قرارًا سريعًا',
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
      {
        path: 'patients',
        name: 'patients',
        component: () => import('../features/patients/pages/PatientsPage.vue'),
        meta: {
          title: 'المرضى والعائلات',
          subtitle: 'بيانات التواصل والأطفال وسجل الزيارات التشغيلي',
          [ROUTE_META_ROLES]: [ClinicMemberRole.Doctor, ClinicMemberRole.Admin],
        },
      },
      {
        path: 'payments', name: 'payments',
        component: () => import('../features/payments/pages/PaymentsPage.vue'),
        meta: {
          title: 'المدفوعات', subtitle: 'التحصيل ومراجعة إيصالات InstaPay',
          [ROUTE_META_ROLES]: [ClinicMemberRole.Doctor, ClinicMemberRole.Admin],
        },
      },
      {
        path: 'reports', name: 'reports',
        component: () => import('../features/reports/pages/ReportsPage.vue'),
        meta: {
          title: 'التقارير', subtitle: 'نشاط العيادة والأداء خلال الفترة',
          [ROUTE_META_ROLES]: [ClinicMemberRole.Doctor, ClinicMemberRole.Admin],
        },
      },
      {
        path: 'settings', name: 'settings',
        component: () => import('../features/settings/pages/SettingsPage.vue'),
        meta: { title: 'الإعدادات والفريق', subtitle: 'سياسات العيادة والجداول والصلاحيات وسجل التدقيق', [ROUTE_META_ROLES]: [ClinicMemberRole.Doctor, ClinicMemberRole.Admin] },
      },
      {
        path: 'consultation/:appointmentId',
        name: 'consultation',
        component: () =>
          import('../features/clinical/pages/ConsultationPage.vue'),
        meta: {
          title: 'جلسة الكشف',
          subtitle: 'التشخيص وخطة العلاج والملخص',
          [ROUTE_META_ROLES]: [ClinicMemberRole.Doctor, ClinicMemberRole.Admin],
        },
      },
      {
        path: 'growth/:childId',
        name: 'growth',
        component: () => import('../features/clinical/pages/GrowthPage.vue'),
        meta: {
          title: 'متابعة النمو',
          subtitle: 'الوزن والطول ومحيط الرأس',
          [ROUTE_META_ROLES]: [ClinicMemberRole.Doctor, ClinicMemberRole.Admin],
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

/**
 * An ended session does not leave anybody on a dead board.
 *
 * The guard only runs on navigation, and somebody watching the queue is not
 * navigating: their poll comes back 401, the token is cleared, and without this
 * the screen would sit there asking again with a token the API has stopped
 * accepting. Leaving the route also unmounts the screens, which disposes their
 * polling scopes — the loops stop because nothing is left running them.
 *
 * Public routes are skipped so the sign-in page is not replaced with itself.
 */
watch(
  () => session.state.status,
  (status) => {
    if (status !== 'anonymous') return;
    if (router.currentRoute.value.meta[ROUTE_META_PUBLIC] === true) return;
    void router.replace({ name: 'sign-in' });
  },
);

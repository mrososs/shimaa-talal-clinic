import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import AppShell from '../layout/AppShell.vue';
import { session } from '../runtime';
import { createAuthGuard, ROUTE_META_PUBLIC } from './auth-guard';

/**
 * Two branches: the sign-in screen, and everything inside the shell.
 *
 * The shell is a layout route rather than a component each page imports, so the
 * "no clinic access" and "cannot reach the server" states are rendered once,
 * around the router view, instead of by every screen remembering to.
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

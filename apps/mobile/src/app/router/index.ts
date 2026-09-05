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
 * Every page is lazy except the two that decide the first frame — the login
 * screen and home — because those are what a cold start renders and a dynamic
 * import there is a visible blank moment.
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
    component: () => import('../features/onboarding/pages/GuardianSetupPage.vue'),
    meta: { [ROUTE_META_ONBOARDING]: true },
  },
  {
    path: '/onboarding/claim',
    name: 'onboarding-claim',
    component: () => import('../features/onboarding/pages/ClaimAccountPage.vue'),
    meta: { [ROUTE_META_ONBOARDING]: true },
  },
  {
    path: '/onboarding/child',
    name: 'onboarding-child',
    component: () => import('../features/onboarding/pages/ChildSetupPage.vue'),
    meta: { [ROUTE_META_ONBOARDING]: true },
  },
  {
    path: '/',
    name: 'home',
    component: () => import('../features/home/pages/HomePage.vue'),
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

import { createRouter, createWebHistory } from '@ionic/vue-router';
import type { RouteRecordRaw } from 'vue-router';
import HomePage from '../pages/HomePage.vue';

/**
 * Ionic's router wraps vue-router so that page transitions and the native-style
 * navigation stack work. Always create it from `@ionic/vue-router`, never from
 * `vue-router` directly.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

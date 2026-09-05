import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import HomePage from '../pages/HomePage.vue';

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

<script setup lang="ts">
import { IonIcon, IonLabel, IonTabBar, IonTabButton } from '@ionic/vue';
import {
  calendarOutline,
  chatbubblesOutline,
  homeOutline,
  timeOutline,
} from 'ionicons/icons';

/**
 * The bottom navigation, from the design.
 *
 * It is deliberately presentation-only. `MobileTabsShell` owns the Ionic tab
 * router and the framework keeps each tab's navigation stack. Focused flows
 * such as booking and appointment details live outside that shell.
 *
 * The four destinations are all working routes. Focused tasks remain outside
 * this shell so the bottom bar never competes with a form or conversation.
 */

const TAB_ITEMS = [
  {
    tab: 'home',
    label: 'الرئيسية',
    href: '/tabs/home',
    icon: homeOutline,
  },
  {
    tab: 'appointments',
    label: 'المواعيد',
    href: '/tabs/appointments',
    icon: calendarOutline,
  },
  {
    tab: 'queue',
    label: 'الطابور',
    href: '/tabs/queue',
    icon: timeOutline,
  },
  {
    tab: 'messages',
    label: 'الرسائل',
    href: '/tabs/messages',
    icon: chatbubblesOutline,
  },
] as const;
</script>

<template>
  <ion-tab-bar slot="bottom" class="tabbar" aria-label="التنقل الرئيسي">
    <ion-tab-button
      v-for="item in TAB_ITEMS"
      :key="item.tab"
      class="tab"
      :tab="item.tab"
      :href="item.href"
    >
      <ion-icon class="tab__icon" aria-hidden="true" :icon="item.icon" />
      <ion-label>{{ item.label }}</ion-label>
    </ion-tab-button>
  </ion-tab-bar>
</template>

<style scoped>
.tabbar {
  --background: rgba(255, 255, 255, 0.94);
  --border: 0;
  background: var(--background);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--line);
  min-height: calc(70px + var(--ion-safe-area-bottom, 0px));
  padding: 7px 8px max(7px, var(--ion-safe-area-bottom, 0px));
}

.tab {
  --color: var(--muted);
  --color-selected: var(--coral-ink);
  --ripple-color: var(--coral-soft);
  max-width: none;
  min-height: 54px;
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: 11px;
}

.tab__icon {
  box-sizing: content-box;
  width: 20px;
  height: 20px;
  padding: 5px 9px;
  border-radius: var(--r-pill);
  transition:
    color 160ms ease,
    background-color 160ms ease,
    transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tab.tab-selected .tab__icon {
  background: var(--coral-soft);
  transform: translateY(-1px);
}

@media (prefers-reduced-motion: reduce) {
  .tab__icon {
    transition: none;
  }
}
</style>

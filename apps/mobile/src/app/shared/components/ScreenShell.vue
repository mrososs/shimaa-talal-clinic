<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import AppHeader from './AppHeader.vue';
import TabBar from './TabBar.vue';

/**
 * The frame a screen renders inside.
 *
 * Exists so that every page does not restate the same four decisions: whether
 * it has a header, whether it has tabs, how much room the tab bar needs, and
 * where the page's own padding comes from. A screen that set its own would
 * drift from the others within a week.
 *
 * `tabs` is opt-in rather than opt-out. Sign-in, onboarding and the booking
 * flow are all screens where a tab bar would offer a way out of a task the
 * person is in the middle of.
 */
defineProps<{
  title?: string;
  subtitle?: string;
  backTo?: { name: string };
  tabs?: boolean;
}>();
</script>

<template>
  <ion-page>
    <ion-content :scroll-y="true">
      <app-header
        v-if="title"
        :title="title"
        :subtitle="subtitle"
        :back-to="backTo"
      >
        <template #end>
          <slot name="header-end" />
        </template>
      </app-header>

      <slot name="above" />

      <div
        class="screen"
        :class="{ 'screen--tabs': tabs }"
      >
        <slot />
      </div>
    </ion-content>

    <tab-bar v-if="tabs" />
  </ion-page>
</template>

<style scoped>
.screen {
  padding: 18px;
  padding-block-end: 40px;
  max-width: 520px;
  margin-inline: auto;
}

/* Clear the bar rather than sit under it — the last card must stay reachable. */
.screen--tabs {
  padding-block-end: calc(96px + env(safe-area-inset-bottom));
}
</style>

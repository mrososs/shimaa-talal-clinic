<script setup lang="ts">
import { IonContent, IonPage } from '@ionic/vue';
import type { RouteLocationRaw } from 'vue-router';
import AppHeader from './AppHeader.vue';

/**
 * The frame a screen renders inside.
 *
 * It owns the content safe area, optional header and consistent horizontal
 * measure. Navigation belongs to the router-level shells, so a page cannot
 * accidentally draw a duplicate tab bar or place content underneath it.
 */
defineProps<{
  title?: string;
  subtitle?: string;
  backTo?: RouteLocationRaw;
}>();
</script>

<template>
  <ion-page>
    <ion-content
      class="screen-shell__content"
      :scroll-y="true"
    >
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

      <main class="screen">
        <slot />
      </main>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.screen-shell__content {
  --padding-top: var(--ion-safe-area-top, 0px);
  --padding-start: var(--ion-safe-area-left, 0px);
  --padding-end: var(--ion-safe-area-right, 0px);
}

.screen {
  padding: clamp(16px, 4.4vw, 20px);
  padding-block-end: 32px;
  max-width: 520px;
  margin-inline: auto;
}
</style>

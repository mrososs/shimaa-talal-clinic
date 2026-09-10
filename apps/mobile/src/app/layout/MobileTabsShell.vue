<script setup lang="ts">
import { IonPage, IonRouterOutlet, IonTabs } from '@ionic/vue';
import TabBar from '../shared/components/TabBar.vue';
</script>

<template>
  <ion-page>
    <ion-tabs class="mobile-tabs">
      <ion-router-outlet />
      <tab-bar />
    </ion-tabs>
  </ion-page>
</template>

<style scoped>
.mobile-tabs {
  background: var(--bg);
}
</style>

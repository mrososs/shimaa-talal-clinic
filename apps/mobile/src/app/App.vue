<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import PwaStatusHost from './pwa/components/PwaStatusHost.vue';
</script>

<template>
  <ion-app>
    <ion-router-outlet />
    <pwa-status-host />
  </ion-app>
</template>

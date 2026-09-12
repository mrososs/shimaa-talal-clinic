<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import OfflineBanner from './OfflineBanner.vue';
import PwaInstallBanner from './PwaInstallBanner.vue';
import PwaUpdateBanner from './PwaUpdateBanner.vue';
import { useNetworkStatus } from '../composables/useNetworkStatus';
import { usePwaInstall } from '../composables/usePwaInstall';
import { usePwaUpdate } from '../composables/usePwaUpdate';

const route = useRoute();
const network = useNetworkStatus();
const install = usePwaInstall();
const updater = usePwaUpdate();

const showInstall = computed(
  () => route.name === 'home' && install.eligible.value,
);
</script>

<template>
  <div class="pwa-status" aria-live="polite">
    <offline-banner :visible="!network.online.value" />
    <pwa-update-banner
      v-if="updater.visible.value"
      :updating="updater.updating.value"
      @update="updater.update"
      @dismiss="updater.dismiss"
    />
    <pwa-install-banner
      v-if="showInstall"
      :platform="install.platform.value"
      :prompting="install.prompting.value"
      @install="install.install"
      @dismiss="install.dismiss"
    />
  </div>
</template>

<style scoped>
.pwa-status {
  position: fixed;
  z-index: 1000;
  inset-inline: max(12px, env(safe-area-inset-left, 0px));
  inset-block-end: calc(82px + env(safe-area-inset-bottom, 0px));
  max-width: 496px;
  margin-inline: auto;
  display: grid;
  gap: 8px;
  pointer-events: none;
}

.pwa-status > * {
  pointer-events: auto;
}
</style>


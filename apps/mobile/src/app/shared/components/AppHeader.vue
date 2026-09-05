<script setup lang="ts">
import { IonButton, IonIcon } from '@ionic/vue';
import { arrowForward } from 'ionicons/icons';
import { useRouter } from 'vue-router';

/**
 * The bar at the top of a screen: a title, and a way back.
 *
 * The back arrow points *forward* in Ionic's icon set, because in an RTL layout
 * "back" is to the right. Ionic mirrors its own components automatically; a
 * hand-placed icon has to be chosen deliberately.
 */
const props = defineProps<{
  title: string;
  subtitle?: string;
  /** Where back goes. Omitted means no back button — a tab root. */
  backTo?: { name: string };
}>();

const router = useRouter();

function goBack(): void {
  if (props.backTo) {
    void router.replace(props.backTo);
    return;
  }
  void router.back();
}
</script>

<template>
  <header class="appbar">
    <ion-button
      v-if="backTo !== undefined"
      class="appbar__back"
      fill="clear"
      shape="round"
      aria-label="رجوع"
      @click="goBack"
    >
      <ion-icon
        slot="icon-only"
        :icon="arrowForward"
      />
    </ion-button>

    <div class="appbar__text">
      <h1 class="appbar__title">
        {{ title }}
      </h1>
      <p
        v-if="subtitle"
        class="appbar__subtitle"
      >
        {{ subtitle }}
      </p>
    </div>

    <slot name="end" />
  </header>
</template>

<style scoped>
.appbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px 10px;
}

.appbar__back {
  --padding-start: 0;
  --padding-end: 0;
  --background: var(--surface);
  --box-shadow: var(--sh-sm);
  --color: var(--ink);
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  margin: 0;
}

.appbar__text {
  flex: 1;
  min-width: 0;
}

.appbar__title {
  font-family: var(--ff-display);
  font-size: 20px;
  font-weight: 800;
  line-height: 1.3;
  margin: 0;
}

.appbar__subtitle {
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  margin: 2px 0 0;
}
</style>

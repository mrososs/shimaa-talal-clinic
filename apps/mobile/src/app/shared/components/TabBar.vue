<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonIcon } from '@ionic/vue';
import { calendarOutline, homeOutline, timeOutline } from 'ionicons/icons';

/**
 * The bottom navigation, from the design.
 *
 * Three destinations, not the design's four: its fourth is "الرسائل", and
 * messaging is out of scope for this phase. A tab that opens nothing is worse
 * than a tab that is not there.
 *
 * Not `ion-tabs`. That component owns its own router outlet and expects the
 * whole app to be organised around it; this app has screens that must not show
 * tabs at all — sign-in, onboarding, the booking flow — and the shell is
 * simpler when a page decides for itself.
 */

const TABS = [
  { name: 'home', label: 'الرئيسية', icon: homeOutline },
  { name: 'appointments', label: 'المواعيد', icon: calendarOutline },
  { name: 'queue', label: 'الطابور', icon: timeOutline },
] as const;

const route = useRoute();
const router = useRouter();

/**
 * A tab is active for its own route and anything nested under it, so a
 * detail screen keeps its section lit rather than dropping the highlight.
 */
const activeName = computed(() => {
  const matched = route.matched.map((record) => record.name);
  return TABS.find((tab) => matched.includes(tab.name))?.name ?? null;
});
</script>

<template>
  <nav class="tabbar">
    <button
      v-for="tab in TABS"
      :key="tab.name"
      type="button"
      class="tab"
      :class="{ 'tab--active': activeName === tab.name }"
      :aria-current="activeName === tab.name ? 'page' : undefined"
      @click="router.replace({ name: tab.name })"
    >
      <span class="tab__ico">
        <ion-icon :icon="tab.icon" />
      </span>
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  position: absolute;
  bottom: 0;
  inset-inline: 0;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--line);
  display: flex;
  /* The extra bottom padding clears the home indicator on a modern handset. */
  padding: 8px 10px calc(10px + env(safe-area-inset-bottom));
  z-index: 40;
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 0;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--muted);
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: 11px;
  transition: color 0.15s ease;
}

.tab--active {
  color: var(--coral);
}

.tab__ico {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: var(--r-pill);
  font-size: 19px;
  transition: background 0.2s ease;
}

.tab--active .tab__ico {
  background: var(--coral-soft);
}
</style>

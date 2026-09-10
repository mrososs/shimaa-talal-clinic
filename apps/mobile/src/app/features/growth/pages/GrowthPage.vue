<script setup lang="ts">
import { computed } from 'vue';
import {
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import GrowthChart from '../components/GrowthChart.vue';
import GrowthHistory from '../components/GrowthHistory.vue';
import { useGrowth } from '../composables/useGrowth';
import { session } from '../../../runtime';

const growth = useGrowth();
const timezone = computed(() => session.state.identity?.clinic.timezone);

async function refresh(event?: RefresherCustomEvent): Promise<void> {
  await growth.refresh();
  await event?.target.complete();
}

onIonViewWillEnter(() => void growth.refresh());
</script>

<template>
  <screen-shell
    title="نمو الطفل"
    subtitle="قياسات مسجّلة في العيادة فقط"
    :back-to="{ name: 'home' }"
  >
    <template #above>
      <ion-refresher
        slot="fixed"
        @ion-refresh="refresh($event)"
      >
        <ion-refresher-content />
      </ion-refresher>
    </template>

    <div class="stack">
      <div
        class="child-picker"
        aria-label="اختيار الطفل"
      >
        <button
          v-for="child in growth.children.value"
          :key="child.id"
          type="button"
          class="chip"
          :class="{ 'chip--on': growth.selectedChildId.value === child.id }"
          @click="growth.selectChild(child.id)"
        >
          {{ child.fullName }}
        </button>
      </div>

      <form-notice :message="growth.failure.value" />

      <div
        v-if="growth.loading.value"
        class="card growth-loading"
      >
        <ion-spinner name="crescent" />
        <p>جارٍ تحميل القياسات…</p>
      </div>

      <template v-else-if="growth.view.value">
        <growth-chart :measurements="growth.view.value.measurements" />

        <growth-history
          v-if="growth.view.value.measurements.length > 0"
          :measurements="growth.view.value.measurements"
          :timezone="timezone"
        />
        <div
          v-else
          class="card growth-empty"
        >
          <h2 class="section-title">
            لا توجد قياسات بعد
          </h2>
          <p>
            ستظهر قياسات الوزن والطول ومحيط الرأس هنا بعد تسجيلها في العيادة.
          </p>
        </div>
      </template>
    </div>
  </screen-shell>
</template>

<style scoped>
.child-picker {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-block-end: 3px;
  scrollbar-width: none;
}

.child-picker::-webkit-scrollbar {
  display: none;
}

.child-picker .chip {
  flex-shrink: 0;
  min-block-size: 44px;
  font: inherit;
}

.growth-loading,
.growth-empty {
  display: grid;
  place-items: center;
  gap: 10px;
  min-block-size: 150px;
  text-align: center;
}

.growth-loading p,
.growth-empty p {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
}
</style>

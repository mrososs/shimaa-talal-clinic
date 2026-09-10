<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { session } from '../../../runtime';
import OverviewKpis from '../components/OverviewKpis.vue';
import OverviewQueue from '../components/OverviewQueue.vue';
import PendingBookingRequests from '../components/PendingBookingRequests.vue';
import { useDashboardSummary } from '../composables/useDashboardSummary';

/**
 * The clinic's day, as far as it is known.
 *
 * Today it shows the clinic's own date and policy, which is genuinely useful —
 * "today" here is Africa/Cairo, computed by the server, not the browser's idea
 * of it. Appointments and the live queue land on this page as they are built.
 */

const identity = computed(() => session.state.identity);
const dashboard = useDashboardSummary();

onMounted(() => {
  void dashboard.open(identity.value?.clinic.today);
});
</script>

<template>
  <div
    v-if="identity"
    class="dstack"
  >
    <section class="overview__welcome">
      <div>
        <p class="overview__eyebrow">
          يوم العيادة
        </p>
        <h2>أهلاً {{ identity.member.displayName }} 👋</h2>
        <p>كل ما يحتاج انتباهك اليوم في مكان واحد.</p>
      </div>
      <button
        class="dbtn dbtn--ghost dbtn--sm"
        type="button"
        :disabled="dashboard.refreshing.value"
        @click="dashboard.refresh()"
      >
        {{ dashboard.refreshing.value ? 'جارٍ التحديث…' : 'تحديث البيانات' }}
      </button>
    </section>

    <p
      v-if="dashboard.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ dashboard.failure.value }}
    </p>

    <div
      v-if="dashboard.loading.value"
      class="overview__loading"
      aria-live="polite"
    >
      جارٍ تجهيز ملخص اليوم…
    </div>

    <template v-else-if="dashboard.summary.value">
      <OverviewKpis
        :appointments="dashboard.summary.value.appointments"
        :queue="dashboard.summary.value.queue"
      />
      <div class="overview__columns">
        <OverviewQueue
          :now-serving="dashboard.summary.value.nowServing"
          :next-waiting="dashboard.summary.value.nextWaiting"
        />
        <PendingBookingRequests
          :requests="dashboard.summary.value.pendingRequests"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.overview__welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px 2px 2px;
}

.overview__welcome h2 {
  font-size: clamp(1.55rem, 3vw, 2.15rem);
}
.overview__welcome > div > p:last-child {
  color: var(--ink-2);
  font-weight: 600;
}
.overview__eyebrow {
  color: var(--coral-ink);
  font-size: 12px;
  font-weight: 800;
}
.overview__columns {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 18px;
  align-items: start;
}
.overview__loading {
  min-height: 260px;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  border-radius: var(--r-md);
  background: var(--surface);
}

@media (max-width: 980px) {
  .overview__columns {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .overview__welcome {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

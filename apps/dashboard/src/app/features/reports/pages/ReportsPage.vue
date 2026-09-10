<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { session } from '../../../runtime';
import ReportKpis from '../components/ReportKpis.vue';
import { useReports } from '../composables/useReports';
const store = useReports(),
  today =
    session.state.identity?.clinic.today ??
    new Date().toISOString().slice(0, 10),
  to = ref(today),
  from = ref(addDays(today, -6));
const maxActivity = computed(() =>
  Math.max(
    1,
    ...(store.data.value?.weeklyActivity.map((v) => v.appointments) ?? [1]),
  ),
);
onMounted(() => store.load(from.value, to.value));
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
</script>
<template>
  <div class="dstack">
    <form
      class="dcard dcard--pad report-toolbar"
      @submit.prevent="store.load(from, to)"
    >
      <label>من<input
        v-model="from"
        type="date"
        required
      ></label><label>إلى<input
        v-model="to"
        type="date"
        required
      ></label><button class="dbtn dbtn--primary">
        تطبيق
      </button><button
        class="dbtn dbtn--ghost"
        type="button"
        @click="store.exportCsv(from, to)"
      >
        تصدير CSV
      </button>
    </form>
    <p
      v-if="store.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ store.failure.value }}
    </p>
    <div
      v-if="store.loading.value"
      class="dcard dcard--pad"
    >
      جارٍ تجميع التقرير…
    </div>
    <template v-else-if="store.data.value">
      <ReportKpis :report="store.data.value" />
      <section class="report-grid">
        <article class="dcard dcard--pad dstack">
          <h2>النشاط اليومي</h2>
          <div
            v-if="!store.data.value.weeklyActivity.length"
            class="dempty"
          >
            لا توجد مواعيد في الفترة.
          </div>
          <div
            v-for="day in store.data.value.weeklyActivity"
            :key="day.date"
            class="activity"
          >
            <time>{{ day.date }}</time><span><i
              :style="{ width: `${(day.appointments / maxActivity) * 100}%` }"
            /></span><strong>{{ day.appointments }}</strong>
          </div>
        </article>
        <article class="dcard dcard--pad dstack">
          <h2>مصدر الحجوزات</h2>
          <div class="split">
            <div>
              <strong>{{
                store.data.value.appointments.bySource.online
              }}</strong><span>حجز أونلاين</span>
            </div>
            <div>
              <strong>{{
                store.data.value.appointments.bySource.clinic
              }}</strong><span>من العيادة</span>
            </div>
          </div>
          <h2>أكثر ساعات الوصول</h2>
          <div class="chips">
            <span
              v-for="hour in store.data.value.queue.peakHours"
              :key="hour.hour"
              class="dbadge"
            >{{ hour.hour }}:00 · {{ hour.count }}</span><span
              v-if="!store.data.value.queue.peakHours.length"
              class="dmuted"
            >لا توجد بيانات وصول.</span>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>
<style scoped>
.report-toolbar {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}
.report-toolbar label {
  display: grid;
  gap: 5px;
  font-weight: 700;
}
.report-toolbar input {
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 9px;
}
.report-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}
.activity {
  display: grid;
  grid-template-columns: 95px 1fr 32px;
  align-items: center;
  gap: 9px;
}
.activity > span {
  height: 9px;
  background: var(--surface-2);
  border-radius: 99px;
  overflow: hidden;
}
.activity i {
  display: block;
  height: 100%;
  background: var(--coral);
  border-radius: inherit;
}
.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.split div {
  display: grid;
  padding: 14px;
  background: var(--surface-2);
  border-radius: 12px;
}
.split strong {
  font-size: 25px;
}
.split span {
  color: var(--muted);
}
.chips {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
@media (max-width: 900px) {
  .report-grid {
    grid-template-columns: 1fr;
  }
}
</style>

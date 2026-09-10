<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { useGrowthTracking } from '../composables/useGrowthTracking';

type Metric = 'weightKg' | 'heightCm';
const route = useRoute();
const childId = computed(() => String(route.params.childId));
const childName = computed(() => String(route.query.childName ?? 'الطفل'));
const metric = shallowRef<Metric>('weightKg');
const state = useGrowthTracking();
const unit = computed(() => (metric.value === 'weightKg' ? 'كجم' : 'سم'));
const label = computed(() => (metric.value === 'weightKg' ? 'الوزن' : 'الطول'));
const points = computed(() =>
  [...state.measurements.value]
    .reverse()
    .map((measurement) => ({
      value: measurement[metric.value],
      date: new Intl.DateTimeFormat('ar-EG', {
        month: 'short',
        year: '2-digit',
      }).format(new Date(measurement.measuredAt)),
    }))
    .filter(
      (point): point is { value: number; date: string } => point.value !== null,
    ),
);
const polyline = computed(() => {
  if (points.value.length < 2) return '';
  const values = points.value.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return points.value
    .map((point, index) => {
      const x = 30 + (index / (points.value.length - 1)) * 540;
      const y = 190 - ((point.value - min) / range) * 140;
      return `${x},${y}`;
    })
    .join(' ');
});

onMounted(() => void state.load(childId.value));
</script>

<template>
  <div class="dstack growth">
    <header class="growth__head">
      <div>
        <span class="dmuted">متابعة النمو</span>
        <h1>{{ childName }}</h1>
      </div>
      <div
        class="dtabs"
        aria-label="نوع القياس"
      >
        <button
          type="button"
          :class="{ on: metric === 'weightKg' }"
          @click="metric = 'weightKg'"
        >
          الوزن
        </button>
        <button
          type="button"
          :class="{ on: metric === 'heightCm' }"
          @click="metric = 'heightCm'"
        >
          الطول
        </button>
      </div>
    </header>
    <p
      v-if="state.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ state.failure.value }}
    </p>
    <div class="growth__layout">
      <section class="dcard dcard--pad chart-card">
        <div>
          <span class="dmuted">{{ label }} الحالي · {{ unit }}</span>
          <strong class="chart-card__value">{{
            points.at(-1)?.value ?? '—'
          }}</strong>
        </div>
        <svg
          v-if="points.length > 1"
          viewBox="0 0 600 220"
          role="img"
          :aria-label="`تطور ${label}`"
        >
          <line
            v-for="y in [50, 120, 190]"
            :key="y"
            x1="30"
            x2="570"
            :y1="y"
            :y2="y"
            class="chart-grid"
          />
          <polyline
            :points="polyline"
            class="chart-line"
          />
        </svg>
        <p
          v-else
          class="dmuted chart-card__empty"
        >
          يلزم قياسان على الأقل لعرض منحنى النمو.
        </p>
      </section>

      <section class="dcard dcard--pad">
        <h2 class="dcard__title">
          تسجيل قياس جديد
        </h2>
        <form
          class="measurement-form"
          @submit.prevent="state.add(childId)"
        >
          <label class="dfield"><span class="dfield__label">الوزن · كجم</span><input
            v-model.number="state.form.weightKg"
            class="dinput"
            type="number"
            step="0.01"
            min="0.2"
            max="300"
          ></label>
          <label class="dfield"><span class="dfield__label">الطول · سم</span><input
            v-model.number="state.form.heightCm"
            class="dinput"
            type="number"
            step="0.01"
            min="20"
            max="250"
          ></label>
          <label class="dfield"><span class="dfield__label">محيط الرأس · سم</span><input
            v-model.number="state.form.headCircumferenceCm"
            class="dinput"
            type="number"
            step="0.01"
            min="15"
            max="100"
          ></label>
          <button
            class="dbtn dbtn--primary"
            type="submit"
            :disabled="state.working.value"
          >
            {{ state.working.value ? 'جارٍ الحفظ…' : 'حفظ القياس' }}
          </button>
        </form>
      </section>
    </div>

    <section class="dcard history">
      <header class="dcard__head">
        <h2 class="dcard__title">
          سجل القياسات
        </h2>
      </header>
      <article
        v-for="measurement in state.measurements.value"
        :key="measurement.id"
        class="history__row"
      >
        <span>{{
          new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(
            new Date(measurement.measuredAt),
          )
        }}</span>
        <strong>{{ measurement.weightKg ?? '—' }} كجم</strong>
        <strong>{{ measurement.heightCm ?? '—' }} سم</strong>
        <strong>{{ measurement.headCircumferenceCm ?? '—' }} سم محيط الرأس</strong>
      </article>
      <p
        v-if="!state.loading.value && state.measurements.value.length === 0"
        class="dmuted history__empty"
      >
        لا توجد قياسات مسجلة.
      </p>
    </section>
  </div>
</template>

<style scoped>
.growth__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.growth__head h1 {
  margin: 2px 0 0;
  font-family: var(--ff-display);
}
.growth__layout {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 18px;
}
.chart-card__value {
  display: block;
  color: var(--coral);
  font: 800 34px var(--ff-display);
}
.chart-grid {
  stroke: var(--line);
  stroke-dasharray: 4 5;
}
.chart-line {
  fill: none;
  stroke: var(--coral);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.chart-card__empty {
  display: grid;
  place-items: center;
  min-height: 220px;
}
.measurement-form {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}
.history {
  overflow: hidden;
}
.history__row {
  display: grid;
  grid-template-columns: 1fr repeat(3, auto);
  gap: 20px;
  padding: 13px 20px;
  border-top: 1px solid var(--line);
}
.history__empty {
  padding: 24px;
  text-align: center;
}
@media (max-width: 900px) {
  .growth__layout {
    grid-template-columns: 1fr;
  }
  .history__row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

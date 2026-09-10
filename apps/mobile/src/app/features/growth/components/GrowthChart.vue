<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { ParentGrowthMeasurement } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';

const props = defineProps<{
  measurements: ParentGrowthMeasurement[];
}>();

type Metric = 'weightKg' | 'heightCm';
const metric = shallowRef<Metric>('weightKg');

const metricLabel = computed(() =>
  metric.value === 'weightKg' ? 'الوزن بالكيلو' : 'الطول بالسنتيمتر',
);

const points = computed(() => {
  const values = [...props.measurements]
    .reverse()
    .map((measurement) => measurement[metric.value])
    .filter((value): value is number => value !== null);
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x =
        values.length === 1 ? 150 : 16 + (index / (values.length - 1)) * 268;
      const y = 104 - ((value - min) / spread) * 82;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});

const latest = computed(
  () =>
    props.measurements.find(
      (measurement) => measurement[metric.value] !== null,
    )?.[metric.value] ?? null,
);
</script>

<template>
  <section
    class="growth-chart"
    aria-labelledby="growth-chart-title"
  >
    <div class="growth-chart__head">
      <div>
        <h2
          id="growth-chart-title"
          class="section-title"
        >
          منحنى النمو
        </h2>
        <p class="growth-chart__latest">
          <template v-if="latest !== null">
            آخر قياس: {{ arabicDigits(latest) }}
            {{ metric === 'weightKg' ? 'كجم' : 'سم' }}
          </template>
          <template v-else>
            لا يوجد قياس لهذه القيمة بعد
          </template>
        </p>
      </div>
      <div
        class="growth-chart__switch"
        aria-label="نوع القياس"
      >
        <button
          type="button"
          :class="{ 'growth-chart__switch-button--on': metric === 'weightKg' }"
          @click="metric = 'weightKg'"
        >
          الوزن
        </button>
        <button
          type="button"
          :class="{ 'growth-chart__switch-button--on': metric === 'heightCm' }"
          @click="metric = 'heightCm'"
        >
          الطول
        </button>
      </div>
    </div>

    <div
      v-if="points"
      class="growth-chart__plot"
    >
      <svg
        viewBox="0 0 300 120"
        role="img"
        :aria-label="`${metricLabel} عبر الزيارات`"
      >
        <path
          class="growth-chart__guide"
          d="M16 104H284 M16 63H284 M16 22H284"
        />
        <polyline
          class="growth-chart__line"
          :points="points"
        />
      </svg>
    </div>
    <p
      v-else
      class="growth-chart__empty"
    >
      سيظهر المنحنى بعد أن تسجّل العيادة أول قياسين.
    </p>
  </section>
</template>

<style scoped>
.growth-chart {
  display: grid;
  gap: 16px;
  padding: 18px;
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--sh-sm);
}

.growth-chart__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.growth-chart__latest {
  margin: 3px 0 0;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
}

.growth-chart__switch {
  display: flex;
  padding: 3px;
  border-radius: var(--r-pill);
  background: var(--teal-soft);
}

.growth-chart__switch button {
  min-block-size: 38px;
  border: 0;
  border-radius: var(--r-pill);
  padding-inline: 12px;
  background: transparent;
  color: var(--teal-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
}

.growth-chart__switch-button--on {
  background: var(--surface) !important;
  box-shadow: var(--sh-sm);
}

.growth-chart__plot {
  overflow: hidden;
  border-radius: var(--r-md);
  background: linear-gradient(180deg, var(--teal-soft), var(--surface));
}

.growth-chart__plot svg {
  display: block;
  inline-size: 100%;
  block-size: 148px;
}

.growth-chart__guide {
  fill: none;
  stroke: color-mix(in srgb, var(--teal) 22%, transparent);
  stroke-width: 1;
}

.growth-chart__line {
  fill: none;
  stroke: var(--teal);
  stroke-width: 5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.growth-chart__empty {
  margin: 0;
  padding-block: 26px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
</style>

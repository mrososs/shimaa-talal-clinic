<script setup lang="ts">
import type { ParentGrowthMeasurement } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';

defineProps<{
  measurements: ParentGrowthMeasurement[];
  timezone?: string;
}>();

function dateLabel(value: string, timezone = 'Africa/Cairo'): string {
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeZone: timezone,
  }).format(new Date(value));
}

function valueLabel(value: number | null, unit: string): string {
  return value === null ? '—' : `${arabicDigits(value)} ${unit}`;
}
</script>

<template>
  <section class="stack stack--tight">
    <h2 class="section-title">
      سجل القياسات
    </h2>
    <article
      v-for="measurement in measurements"
      :key="measurement.id"
      class="history-row"
    >
      <p class="history-row__date">
        {{ dateLabel(measurement.measuredAt, timezone) }}
      </p>
      <dl class="history-row__values">
        <div>
          <dt>الوزن</dt>
          <dd>{{ valueLabel(measurement.weightKg, 'كجم') }}</dd>
        </div>
        <div>
          <dt>الطول</dt>
          <dd>{{ valueLabel(measurement.heightCm, 'سم') }}</dd>
        </div>
        <div>
          <dt>محيط الرأس</dt>
          <dd>{{ valueLabel(measurement.headCircumferenceCm, 'سم') }}</dd>
        </div>
      </dl>
    </article>
  </section>
</template>

<style scoped>
.history-row {
  padding-block: 14px;
  border-block-end: 1px solid var(--line);
}

.history-row__date {
  margin: 0 0 9px;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 700;
}

.history-row__values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.history-row__values div {
  min-width: 0;
}

.history-row__values dt {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
}

.history-row__values dd {
  margin: 2px 0 0;
  color: var(--ink);
  font-family: var(--ff-display);
  font-size: 15px;
  font-weight: 800;
}
</style>

<script setup lang="ts">
import type { DeepReadonly } from 'vue';
import type { ClinicReport } from '@clinic/contracts';
defineProps<{ report: DeepReadonly<ClinicReport> }>();
const value = (n: number | null, suffix = '') =>
  n === null
    ? 'لا توجد بيانات'
    : `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(n)}${suffix}`;
</script>
<template>
  <section class="report-kpis">
    <article class="dcard dcard--pad">
      <span>إجمالي المواعيد</span><strong>{{ value(report.appointments.total) }}</strong>
    </article>
    <article class="dcard dcard--pad">
      <span>نسبة الإتمام</span><strong>{{
        value(
          report.appointments.total
            ? (report.appointments.completed / report.appointments.total) * 100
            : 0,
          '٪',
        )
      }}</strong>
    </article>
    <article class="dcard dcard--pad">
      <span>متوسط الانتظار</span><strong>{{ value(report.queue.averageWaitMinutes, ' د') }}</strong>
    </article>
    <article
      v-if="report.financial"
      class="dcard dcard--pad"
    >
      <span>الإيراد المحصل</span><strong>{{
        new Intl.NumberFormat('ar-EG', {
          style: 'currency',
          currency: 'EGP',
        }).format(report.financial.collectedMinor / 100)
      }}</strong>
    </article>
  </section>
</template>
<style scoped>
.report-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.report-kpis article {
  display: grid;
  gap: 5px;
}
.report-kpis span {
  color: var(--muted);
}
.report-kpis strong {
  font-size: 21px;
}
@media (max-width: 900px) {
  .report-kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 520px) {
  .report-kpis {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  DashboardAppointmentCounts,
  DashboardQueueCounts,
} from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';

const props = defineProps<{
  appointments: DashboardAppointmentCounts;
  queue: DashboardQueueCounts;
}>();

const cards = computed(() => [
  {
    label: 'مواعيد اليوم',
    value: props.appointments.total,
    note: `${arabicDigits(props.appointments.requested)} بانتظار الموافقة`,
    tone: 'coral',
  },
  {
    label: 'في الانتظار الآن',
    value: props.queue.waiting,
    note: props.queue.called > 0 ? 'يوجد مريض تم استدعاؤه' : 'الترتيب محدّث',
    tone: 'sun',
  },
  {
    label: 'داخل الكشف',
    value: props.queue.inService,
    note: props.queue.inService > 0 ? 'الجلسة جارية' : 'لا يوجد كشف جارٍ',
    tone: 'sky',
  },
  {
    label: 'زيارات مكتملة',
    value: props.appointments.completed,
    note: `${arabicDigits(props.queue.done)} انتهوا من الطابور`,
    tone: 'teal',
  },
]);
</script>

<template>
  <section
    class="overview-kpis"
    aria-label="ملخص اليوم"
  >
    <article
      v-for="card in cards"
      :key="card.label"
      class="overview-kpi"
      :class="`overview-kpi--${card.tone}`"
    >
      <p class="overview-kpi__label">
        {{ card.label }}
      </p>
      <strong class="overview-kpi__value">
        {{ arabicDigits(card.value) }}
      </strong>
      <p class="overview-kpi__note">
        {{ card.note }}
      </p>
    </article>
  </section>
</template>

<style scoped>
.overview-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.overview-kpi {
  position: relative;
  overflow: hidden;
  min-height: 142px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--sh-sm);
}

.overview-kpi::after {
  position: absolute;
  inset-inline-end: -22px;
  inset-block-end: -30px;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: var(--kpi-soft);
  content: '';
}

.overview-kpi--coral {
  --kpi-soft: var(--coral-soft);
}
.overview-kpi--sun {
  --kpi-soft: var(--sun-soft);
}
.overview-kpi--sky {
  --kpi-soft: var(--sky-soft);
}
.overview-kpi--teal {
  --kpi-soft: var(--teal-soft);
}

.overview-kpi__label,
.overview-kpi__note {
  color: var(--ink-2);
  font-weight: 700;
}

.overview-kpi__value {
  display: block;
  margin-block: 4px;
  font-family: var(--ff-display);
  font-size: clamp(2rem, 3vw, 2.75rem);
  line-height: 1;
}

.overview-kpi__note {
  position: relative;
  z-index: 1;
  font-size: 12.5px;
}

@media (max-width: 1100px) {
  .overview-kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .overview-kpis {
    grid-template-columns: 1fr;
  }
}
</style>

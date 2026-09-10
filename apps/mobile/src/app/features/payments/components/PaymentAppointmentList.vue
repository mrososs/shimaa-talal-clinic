<script setup lang="ts">
import type { ParentPaymentOption } from '@clinic/contracts';
import { dayLabel } from '../../../shared/format';

defineProps<{
  appointments: readonly ParentPaymentOption[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [appointmentId: string];
}>();

const VISIT_LABEL: Record<string, string> = {
  new_visit: 'كشف جديد',
  follow_up: 'متابعة',
  vaccination: 'تطعيم',
  consultation: 'استشارة',
  newborn: 'حديث الولادة',
};

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}
</script>

<template>
  <section class="stack stack--tight">
    <h2 class="section-title">اختاري الموعد</h2>
    <button
      v-for="appointment in appointments"
      :key="appointment.appointmentId"
      type="button"
      class="card appointment"
      :class="{ 'appointment--selected': appointment.appointmentId === selectedId }"
      @click="emit('select', appointment.appointmentId)"
    >
      <span class="appointment__mark" aria-hidden="true" />
      <span class="appointment__body">
        <strong>{{ appointment.childName }}</strong>
        <small>
          {{ VISIT_LABEL[appointment.visitType] ?? appointment.visitType }} ·
          {{ dayLabel(appointment.windowStart) }}
        </small>
      </span>
      <strong class="appointment__amount">
        {{ money(appointment.amountMinor, appointment.currency) }}
      </strong>
    </button>
  </section>
</template>

<style scoped>
.appointment {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 2px solid transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.appointment--selected {
  border-color: var(--coral);
  background: var(--coral-soft);
}

.appointment__mark {
  width: 18px;
  height: 18px;
  border: 2px solid var(--muted);
  border-radius: 50%;
  flex: 0 0 auto;
}

.appointment--selected .appointment__mark {
  border: 5px solid var(--coral);
  background: white;
}

.appointment__body {
  display: grid;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.appointment__body small {
  color: var(--ink-2);
  font-weight: 600;
}

.appointment__amount {
  color: var(--coral-ink);
  white-space: nowrap;
}
</style>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { chatbubblesOutline, medkitOutline } from 'ionicons/icons';
import type { ParentPaymentOption } from '@clinic/contracts';
import { dayLabel } from '../../../shared/format';

const props = defineProps<{ appointment: ParentPaymentOption }>();

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
  <article class="card invoice">
    <header class="invoice__head">
      <span
        class="invoice__icon"
        :class="{
          'invoice__icon--consultation':
            appointment.visitType === 'consultation',
        }"
      >
        <ion-icon
          :icon="
            appointment.visitType === 'consultation'
              ? chatbubblesOutline
              : medkitOutline
          "
        />
      </span>
      <div>
        <h2>
          {{
            VISIT_LABEL[props.appointment.visitType] ??
            props.appointment.visitType
          }}
          — {{ props.appointment.childName }}
        </h2>
        <p>{{ dayLabel(props.appointment.windowStart) }}</p>
      </div>
    </header>

    <div class="invoice__row">
      <span>قيمة الخدمة</span>
      <strong>{{
        money(props.appointment.amountMinor, props.appointment.currency)
      }}</strong>
    </div>
    <div class="invoice__total">
      <span>الإجمالي</span>
      <strong>{{
        money(props.appointment.amountMinor, props.appointment.currency)
      }}</strong>
    </div>
  </article>
</template>

<style scoped>
.invoice {
  padding: 20px;
}

.invoice__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-block-end: 14px;
  border-block-end: 1.5px dashed var(--line);
}

.invoice__icon {
  inline-size: 48px;
  block-size: 48px;
  flex: 0 0 auto;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: var(--coral-soft);
  color: var(--coral-ink);
  font-size: 25px;
}

.invoice__icon--consultation {
  background: var(--lav-soft);
  color: #5b3fa0;
}

.invoice__head div {
  min-width: 0;
}

.invoice__head h2 {
  margin: 0;
  font: 800 15.5px/1.45 var(--ff-display);
}

.invoice__head p {
  margin: 2px 0 0;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
}

.invoice__row,
.invoice__total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.invoice__row {
  margin-block-start: 12px;
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 600;
}

.invoice__row strong {
  color: var(--ink);
}

.invoice__total {
  margin-block-start: 12px;
  padding-block-start: 12px;
  border-block-start: 1.5px solid var(--line);
  font-weight: 800;
}

.invoice__total strong {
  color: var(--coral);
  font: 800 26px var(--ff-display);
}
</style>

<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue';
import { IonIcon } from '@ionic/vue';
import { checkmarkCircleOutline, timeOutline } from 'ionicons/icons';
import type { ParentPaymentOption, PaymentRecord } from '@clinic/contracts';

const props = defineProps<{
  result: { payment: PaymentRecord; appointment: ParentPaymentOption };
}>();
const emit = defineEmits<{ track: [] }>();
const action = useTemplateRef<HTMLButtonElement>('action');

const cash = props.result.payment.method === 'cash';

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

onMounted(() => action.value?.focus());
</script>

<template>
  <div class="result" role="status" aria-live="assertive">
    <section class="result__sheet">
      <span class="result__grab" aria-hidden="true" />
      <div class="result__pulse">
        <span class="result__icon">
          <ion-icon :icon="cash ? timeOutline : checkmarkCircleOutline" />
        </span>
      </div>
      <h2>{{ cash ? 'تم تسجيل الدفع نقداً' : 'تم إرسال الإيصال للمراجعة' }}</h2>
      <p>
        <template v-if="cash">
          ستدفعين
          {{ money(result.payment.amountMinor, result.payment.currency) }}
          عند الوصول، ويؤكد الاستقبال الاستلام.
        </template>
        <template v-else>
          استلمنا إيصال
          {{ money(result.payment.amountMinor, result.payment.currency) }}،
          وتراجعه العيادة قبل اعتماد الدفع.
        </template>
      </p>
      <div class="result__safe">
        <ion-icon :icon="checkmarkCircleOutline" />
        <span>سيظهر أي تحديث في حالة الموعد والدفع تلقائياً.</span>
      </div>
      <button
        ref="action"
        type="button"
        class="result__action"
        @click="emit('track')"
      >
        تتبّع حالة الطلب
      </button>
    </section>
  </div>
</template>

<style scoped>
.result {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: flex;
  align-items: flex-end;
  background: rgb(58 51 64 / 42%);
}

.result__sheet {
  inline-size: 100%;
  padding: 10px 20px calc(28px + env(safe-area-inset-bottom));
  border-radius: 30px 30px 0 0;
  background: var(--surface);
  text-align: center;
  animation: payment-sheet-up 340ms cubic-bezier(0.2, 0.85, 0.3, 1) both;
}

.result__grab {
  display: block;
  inline-size: 44px;
  block-size: 5px;
  margin: 4px auto 14px;
  border-radius: var(--r-pill);
  background: var(--line);
}

.result__pulse {
  position: relative;
  inline-size: 86px;
  block-size: 86px;
  margin: 8px auto 4px;
}

.result__pulse::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--sun);
  opacity: 0.18;
  animation: payment-result-pulse 2.2s ease-out infinite;
}

.result__icon {
  position: absolute;
  inset: 8px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--sun-soft);
  color: #b8800f;
  font-size: 42px;
}

.result h2 {
  margin: 10px 0 0;
  font: 800 22px/1.45 var(--ff-display);
}

.result p {
  margin: 8px auto 0;
  max-inline-size: 340px;
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.7;
}

.result__safe {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-block-start: 16px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--surface-2);
  color: var(--ink-2);
  text-align: start;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.55;
}

.result__safe ion-icon {
  flex: 0 0 auto;
  margin-block-start: 1px;
  color: var(--ok);
  font-size: 20px;
}

.result__action {
  inline-size: 100%;
  min-block-size: 56px;
  margin-block-start: 18px;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--coral);
  color: white;
  box-shadow: 0 8px 20px rgb(255 126 95 / 40%);
  font: 800 16px var(--ff-body);
}

@keyframes payment-sheet-up {
  from {
    transform: translateY(100%);
  }
}

@keyframes payment-result-pulse {
  0% {
    transform: scale(0.9);
    opacity: 0.5;
  }
  70%,
  100% {
    transform: scale(1.25);
    opacity: 0;
  }
}
</style>

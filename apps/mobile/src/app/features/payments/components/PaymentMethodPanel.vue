<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  cashOutline,
  checkmarkOutline,
  cloudUploadOutline,
  flashOutline,
  locationOutline,
} from 'ionicons/icons';
import type { ParentPaymentOption } from '@clinic/contracts';

const props = defineProps<{
  appointment: ParentPaymentOption;
  instapayHandle: string | null;
  working: boolean;
}>();

const emit = defineEmits<{
  cash: [];
  instapay: [file: File | null];
}>();

const method = shallowRef<'cash' | 'instapay'>(
  props.instapayHandle ? 'instapay' : 'cash',
);
const receipt = shallowRef<File | null>(null);
const instapayAvailable = computed(() => props.instapayHandle !== null);

function chooseReceipt(event: Event): void {
  receipt.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

watch(
  () => props.instapayHandle,
  (handle) => {
    if (handle === null && method.value === 'instapay') method.value = 'cash';
  },
);

watch(
  () => props.appointment.appointmentId,
  () => {
    receipt.value = null;
  },
);
</script>

<template>
  <section class="payment-methods">
    <h2 class="section-title">طريقة الدفع</h2>

    <div class="payment-methods__list">
      <button
        type="button"
        class="card method"
        :class="{ 'method--selected': method === 'instapay' }"
        :disabled="!instapayAvailable"
        :aria-pressed="method === 'instapay'"
        @click="method = 'instapay'"
      >
        <span class="method__icon method__icon--instapay">
          <ion-icon :icon="flashOutline" />
        </span>
        <span class="method__copy">
          <span class="method__title">
            <strong>InstaPay</strong>
            <b v-if="instapayAvailable">فوري</b>
          </span>
          <small>
            {{
              instapayAvailable
                ? 'حوّلي من تطبيق بنكك ثم ارفعي الإيصال'
                : 'غير متاح حتى تضبطه العيادة'
            }}
          </small>
        </span>
        <span class="method__check">
          <ion-icon v-if="method === 'instapay'" :icon="checkmarkOutline" />
        </span>
      </button>

      <button
        type="button"
        class="card method"
        :class="{ 'method--selected': method === 'cash' }"
        :aria-pressed="method === 'cash'"
        @click="method = 'cash'"
      >
        <span class="method__icon method__icon--cash">
          <ion-icon :icon="cashOutline" />
        </span>
        <span class="method__copy">
          <strong>نقداً في العيادة</strong>
          <small>ادفعي عند الوصول للاستقبال</small>
        </span>
        <span class="method__check">
          <ion-icon v-if="method === 'cash'" :icon="checkmarkOutline" />
        </span>
      </button>
    </div>

    <div v-if="method === 'cash'" class="method-note method-note--cash">
      <ion-icon :icon="locationOutline" />
      <p>سيبقى الدفع قيد المراجعة حتى يؤكد الاستقبال استلامه في العيادة.</p>
    </div>

    <div v-else class="method-note method-note--instapay">
      <p>حوّلي المبلغ إلى عنوان العيادة ثم ارفعي الإيصال للمراجعة.</p>
      <div class="instapay-address">
        <span class="instapay-address__icon">
          <ion-icon :icon="flashOutline" />
        </span>
        <span>
          <small>عنوان الدفع</small>
          <strong dir="ltr">{{ instapayHandle }}</strong>
        </span>
      </div>

      <label class="upload">
        <ion-icon :icon="cloudUploadOutline" />
        <strong>{{ receipt?.name ?? 'اختاري صورة الإيصال أو ملف PDF' }}</strong>
        <small>PDF أو JPG أو PNG أو WebP — حتى ٥ ميجابايت</small>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          @change="chooseReceipt"
        />
      </label>
    </div>

    <div class="payment-methods__sticky">
      <button
        type="button"
        class="payment-submit"
        :disabled="working || (method === 'instapay' && receipt === null)"
        @click="method === 'cash' ? emit('cash') : emit('instapay', receipt)"
      >
        <ion-spinner v-if="working" name="crescent" />
        <template v-else>
          {{
            method === 'cash'
              ? 'تأكيد الدفع نقداً'
              : `إرسال إيصال ${money(appointment.amountMinor, appointment.currency)}`
          }}
        </template>
      </button>
    </div>
  </section>
</template>

<style scoped>
.payment-methods {
  display: grid;
  gap: 12px;
  padding-block-end: calc(86px + env(safe-area-inset-bottom));
}
.payment-methods__list {
  display: grid;
  gap: 12px;
}
.method {
  inline-size: 100%;
  min-block-size: 78px;
  padding: 15px;
  border: 2.5px solid transparent;
  display: flex;
  align-items: center;
  gap: 13px;
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  box-shadow: var(--sh-sm);
}
.method--selected {
  border-color: var(--coral);
}
.method:disabled {
  opacity: 0.48;
  cursor: default;
}
.method__icon {
  inline-size: 46px;
  block-size: 46px;
  flex: 0 0 auto;
  border-radius: 15px;
  display: grid;
  place-items: center;
  font-size: 23px;
}
.method__icon--instapay {
  background: var(--lav-soft);
  color: #5b3fa0;
}
.method__icon--cash {
  background: var(--teal-soft);
  color: var(--teal-ink);
}
.method__copy {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}
.method__title {
  display: flex;
  align-items: center;
  gap: 7px;
}
.method__title b {
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--teal-soft);
  color: var(--teal-ink);
  font-size: 10.5px;
}
.method__copy strong {
  font: 800 15px var(--ff-display);
}
.method__copy small {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}
.method__check {
  inline-size: 24px;
  block-size: 24px;
  flex: 0 0 auto;
  border: 2px solid var(--line);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: white;
}
.method--selected .method__check {
  border-color: var(--coral);
  background: var(--coral);
}
.method-note {
  border-radius: var(--r-md);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.65;
}
.method-note--cash {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px;
  background: var(--teal-soft);
  color: var(--teal-ink);
}
.method-note--cash ion-icon {
  flex: 0 0 auto;
  font-size: 21px;
}
.method-note p {
  margin: 0;
}
.method-note--instapay {
  padding: 16px;
  background: var(--lav-soft);
  color: #5b3fa0;
}
.instapay-address {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-block-start: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface);
}
.instapay-address__icon {
  inline-size: 38px;
  block-size: 38px;
  flex: 0 0 auto;
  border-radius: 11px;
  display: grid;
  place-items: center;
  background: #5b3fa0;
  color: white;
  font-size: 20px;
}
.instapay-address > span:last-child {
  min-width: 0;
  display: grid;
  gap: 2px;
  text-align: start;
}
.instapay-address small {
  font-size: 12px;
}
.instapay-address strong {
  overflow-wrap: anywhere;
  color: var(--ink-2);
  font: 800 13px var(--ff-display);
  text-align: start;
}
.upload {
  position: relative;
  min-block-size: 116px;
  margin-block-start: 12px;
  padding: 14px;
  border: 1.5px dashed #7d62bd;
  border-radius: 16px;
  display: grid;
  place-items: center;
  gap: 3px;
  background: rgb(255 255 255 / 72%);
  color: var(--ink);
  text-align: center;
  cursor: pointer;
}
.upload ion-icon {
  color: #5b3fa0;
  font-size: 28px;
}
.upload small {
  color: var(--ink-2);
  font-size: 11.5px;
}
.upload input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
}
.payment-methods__sticky {
  position: fixed;
  z-index: 30;
  inset-inline: 0;
  inset-block-end: 0;
  padding: 28px max(16px, env(safe-area-inset-left))
    calc(14px + env(safe-area-inset-bottom));
  background: linear-gradient(transparent, var(--bg) 30%);
  pointer-events: none;
}
.payment-submit {
  inline-size: min(488px, 100%);
  min-block-size: 56px;
  margin-inline: auto;
  padding: 14px 20px;
  border: none;
  border-radius: var(--r-pill);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--coral);
  color: white;
  box-shadow: 0 8px 20px rgb(255 126 95 / 40%);
  font: 800 16px var(--ff-body);
  pointer-events: auto;
  cursor: pointer;
}
.payment-submit:disabled {
  opacity: 0.5;
  box-shadow: none;
}
</style>

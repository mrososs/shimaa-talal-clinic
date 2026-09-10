<script setup lang="ts">
import { shallowRef } from 'vue';
import { IonButton, IonIcon, IonSpinner } from '@ionic/vue';
import { cashOutline, cloudUploadOutline } from 'ionicons/icons';
import type { ParentPaymentOption } from '@clinic/contracts';

defineProps<{
  appointment: ParentPaymentOption;
  working: boolean;
}>();

const emit = defineEmits<{
  cash: [];
  instapay: [file: File | null];
}>();

const method = shallowRef<'cash' | 'instapay'>('cash');
const receipt = shallowRef<File | null>(null);

function chooseReceipt(event: Event): void {
  receipt.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}
</script>

<template>
  <section class="stack stack--tight">
    <h2 class="section-title">طريقة الدفع</h2>
    <div class="methods">
      <button
        type="button"
        class="card method"
        :class="{ 'method--selected': method === 'cash' }"
        @click="method = 'cash'"
      >
        <ion-icon :icon="cashOutline" />
        <span><strong>الدفع في العيادة</strong><small>نقداً عند الحضور</small></span>
      </button>
      <button
        type="button"
        class="card method"
        :class="{ 'method--selected': method === 'instapay' }"
        @click="method = 'instapay'"
      >
        <ion-icon :icon="cloudUploadOutline" />
        <span><strong>InstaPay</strong><small>ارفعي صورة التحويل</small></span>
      </button>
    </div>

    <div v-if="method === 'cash'" class="card guidance">
      سيتم تسجيل اختيارك، ويعتمد الاستقبال الدفع عند وصولك للعيادة.
    </div>

    <label v-else class="card upload">
      <ion-icon :icon="cloudUploadOutline" />
      <strong>{{ receipt?.name ?? 'اختاري صورة أو ملف PDF' }}</strong>
      <small>PDF أو JPG أو PNG أو WebP — حتى ٥ ميجابايت</small>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        @change="chooseReceipt"
      />
    </label>

    <ion-button
      expand="block"
      :disabled="working || (method === 'instapay' && receipt === null)"
      @click="method === 'cash' ? emit('cash') : emit('instapay', receipt)"
    >
      <ion-spinner v-if="working" name="crescent" />
      <span v-else>{{ method === 'cash' ? 'اختيار الدفع في العيادة' : 'إرسال الإيصال' }}</span>
    </ion-button>
  </section>
</template>

<style scoped>
.methods {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.method {
  border: 2px solid transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.method--selected {
  border-color: var(--teal);
  background: var(--teal-soft);
}

.method ion-icon {
  color: var(--teal-ink);
  font-size: 23px;
  flex: 0 0 auto;
}

.method span,
.upload {
  display: grid;
  gap: 3px;
}

.method small,
.upload small {
  color: var(--ink-2);
  font-weight: 600;
}

.guidance {
  color: var(--ink-2);
  line-height: 1.7;
  font-size: 13px;
  font-weight: 600;
}

.upload {
  position: relative;
  place-items: center;
  text-align: center;
  border: 1px dashed var(--teal);
  cursor: pointer;
}

.upload ion-icon {
  color: var(--teal-ink);
  font-size: 28px;
}

.upload input {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
}
</style>

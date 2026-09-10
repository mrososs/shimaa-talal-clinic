<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  AppointmentListItem,
  RegisterPaymentInput,
} from '@clinic/contracts';
const props = defineProps<{
  appointments: AppointmentListItem[];
  working: boolean;
}>();
const emit = defineEmits<{
  cash: [RegisterPaymentInput];
  instapay: [RegisterPaymentInput, File];
}>();
const open = ref(false),
  appointmentId = ref(''),
  amount = ref(''),
  method = ref<'cash' | 'instapay'>('cash'),
  file = ref<File | null>(null);
const selected = computed(() =>
  props.appointments.find((a) => a.id === appointmentId.value),
);
function submit() {
  const a = selected.value,
    value = Math.round(Number(amount.value) * 100);
  if (
    !a ||
    !Number.isFinite(value) ||
    value < 1 ||
    (method.value === 'instapay' && !file.value)
  )
    return;
  const input: RegisterPaymentInput = {
    appointmentId: a.id,
    childId: a.childId,
    guardianId: a.guardianId,
    amountMinor: value,
    currency: 'EGP',
    idempotencyKey: crypto.randomUUID(),
  };
  if (method.value === 'cash') emit('cash', input);
  else emit('instapay', input, file.value!);
  open.value = false;
}
</script>
<template>
  <button
    class="dbtn dbtn--primary"
    type="button"
    @click="open = !open"
  >
    تسجيل دفعة
  </button>
  <form
    v-if="open"
    class="dcard dcard--pad payment-form dstack"
    @submit.prevent="submit"
  >
    <h2>تسجيل دفعة جديدة</h2>
    <label>الموعد<select
      v-model="appointmentId"
      required
    >
      <option
        value=""
        disabled
      >اختاري الموعد</option>
      <option
        v-for="a in appointments"
        :key="a.id"
        :value="a.id"
      >
        {{ a.child.fullName }} · {{ a.guardian.fullName }}
      </option>
    </select></label><label>المبلغ بالجنيه<input
      v-model="amount"
      type="number"
      min="0.01"
      step="0.01"
      required
    ></label><label>طريقة الدفع<select v-model="method">
      <option value="cash">نقدي</option>
      <option value="instapay">InstaPay</option>
    </select></label><label v-if="method === 'instapay'">صورة الإيصال<input
      type="file"
      accept="application/pdf,image/jpeg,image/png,image/webp"
      required
      @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null"
    ></label>
    <div class="dactions">
      <button
        class="dbtn dbtn--primary"
        :disabled="working"
      >
        حفظ
      </button><button
        class="dbtn dbtn--ghost"
        type="button"
        @click="open = false"
      >
        إلغاء
      </button>
    </div>
  </form>
</template>
<style scoped>
.payment-form {
  max-width: 680px;
}
.payment-form label {
  display: grid;
  gap: 6px;
  font-weight: 700;
}
.payment-form input,
.payment-form select {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
}
</style>

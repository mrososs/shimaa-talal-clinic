<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue';
import { ClinicDialog } from '@clinic/client-ui';
import type { CreateClinicalMeasurementInput } from '@clinic/contracts';

const props = defineProps<{
  open: boolean;
  childName?: string;
  working: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [input: CreateClinicalMeasurementInput];
}>();

const form = reactive<CreateClinicalMeasurementInput>({
  weightKg: null,
  heightCm: null,
  headCircumferenceCm: null,
  temperatureC: null,
});
const validation = shallowRef<string | null>(null);

const hasValue = computed(() =>
  [
    form.weightKg,
    form.heightCm,
    form.headCircumferenceCm,
    form.temperatureC,
  ].some((value) => value !== null && value !== undefined),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    Object.assign(form, {
      weightKg: null,
      heightCm: null,
      headCircumferenceCm: null,
      temperatureC: null,
    });
    validation.value = null;
  },
);

function submit(): void {
  if (!hasValue.value) {
    validation.value = 'سجّلي قياسًا واحدًا على الأقل.';
    return;
  }
  validation.value = null;
  emit('submit', { ...form });
}
</script>

<template>
  <ClinicDialog
    :open="open"
    title="تسجيل القياسات"
    :subject="childName"
    @close="emit('close')"
  >
    <form
      class="measurements"
      @submit.prevent="submit"
    >
      <p class="dmuted measurements__hint">
        يمكن حفظ أي قياس متاح الآن، ولا يلزم ملء كل الحقول.
      </p>

      <div class="measurements__grid">
        <label class="dfield">
          <span class="dfield__label">الوزن · كجم</span>
          <input
            v-model.number="form.weightKg"
            class="dinput"
            type="number"
            min="0.2"
            max="300"
            step="0.01"
            :disabled="working"
          >
        </label>
        <label class="dfield">
          <span class="dfield__label">الطول · سم</span>
          <input
            v-model.number="form.heightCm"
            class="dinput"
            type="number"
            min="20"
            max="250"
            step="0.01"
            :disabled="working"
          >
        </label>
        <label class="dfield">
          <span class="dfield__label">محيط الرأس · سم</span>
          <input
            v-model.number="form.headCircumferenceCm"
            class="dinput"
            type="number"
            min="15"
            max="100"
            step="0.01"
            :disabled="working"
          >
        </label>
        <label class="dfield">
          <span class="dfield__label">درجة الحرارة · °م</span>
          <input
            v-model.number="form.temperatureC"
            class="dinput"
            type="number"
            min="30"
            max="45"
            step="0.1"
            :disabled="working"
          >
        </label>
      </div>

      <p
        v-if="validation"
        class="dnotice dnotice--error"
        role="alert"
      >
        {{ validation }}
      </p>
    </form>

    <template #actions>
      <button
        class="dbtn dbtn--ghost"
        type="button"
        :disabled="working"
        @click="emit('close')"
      >
        تراجع
      </button>
      <button
        class="dbtn dbtn--teal"
        type="button"
        :disabled="working"
        @click="submit"
      >
        {{ working ? 'جارٍ الحفظ…' : 'حفظ القياسات' }}
      </button>
    </template>
  </ClinicDialog>
</template>

<style scoped>
.measurements {
  display: grid;
  gap: 14px;
}

.measurements__hint {
  margin: 0;
}

.measurements__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 620px) {
  .measurements__grid {
    grid-template-columns: 1fr;
  }
}
</style>

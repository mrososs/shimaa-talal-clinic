<script setup lang="ts">
import { shallowRef, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  childName?: string;
  working: boolean;
}>();
const emit = defineEmits<{ close: []; submit: [file: File] }>();

const selected = shallowRef<File | null>(null);
const validation = shallowRef<string | null>(null);
const allowed = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const maxSize = 10 * 1024 * 1024;

watch(
  () => props.open,
  (open) => {
    if (open) {
      selected.value = null;
      validation.value = null;
    }
  },
);

function choose(event: Event): void {
  selected.value = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  validation.value = null;
}

function submit(): void {
  const file = selected.value;
  if (
    file === null ||
    !allowed.has(file.type) ||
    file.size < 1 ||
    file.size > maxSize
  ) {
    validation.value =
      'اختاري ملف PDF أو صورة JPG أو PNG أو WebP بحجم لا يتجاوز 10 م.ب.';
    return;
  }
  emit('submit', file);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      @click.self="emit('close')"
    >
      <section
        class="dcard upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
      >
        <header>
          <div>
            <span class="dmuted">المستندات الطبية</span>
            <h2 id="upload-title">
              رفع ملف {{ childName ? `لـ${childName}` : '' }}
            </h2>
          </div>
          <button
            class="dbtn dbtn--ghost dbtn--sm"
            type="button"
            :disabled="working"
            @click="emit('close')"
          >
            إغلاق
          </button>
        </header>
        <form
          class="upload-dialog__form"
          @submit.prevent="submit"
        >
          <label class="dfield">
            <span class="dfield__label">الملف</span>
            <input
              class="dinput"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              :disabled="working"
              @change="choose"
            >
          </label>
          <p class="dmuted upload-dialog__hint">
            PDF أو صورة، بحد أقصى 10 م.ب.
          </p>
          <p
            v-if="validation"
            class="dnotice dnotice--error"
            role="alert"
          >
            {{ validation }}
          </p>
          <button
            class="dbtn dbtn--primary"
            type="submit"
            :disabled="working"
          >
            {{ working ? 'جارٍ الرفع…' : 'رفع الملف' }}
          </button>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  z-index: 80;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(27 38 48 / 45%);
}
.upload-dialog {
  width: min(520px, 100%);
  padding: 20px;
}
.upload-dialog header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 14px;
}
.upload-dialog h2 {
  margin: 3px 0 0;
  font-family: var(--ff-display);
}
.upload-dialog__form {
  display: grid;
  gap: 14px;
  margin-top: 20px;
}
.upload-dialog__hint {
  margin: -7px 0 0;
  font-size: 12px;
}
</style>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

/**
 * "Why?" — asked once, properly, before something irreversible or unusual.
 *
 * Marking an emergency, skipping a patient whose grace has not run out, and
 * removing somebody from the queue all change what happens to a family, and
 * each is a decision a colleague may have to explain tomorrow. The reason is
 * stored against the person who acted, so it has to be typed rather than
 * defaulted.
 *
 * Deliberately not `window.prompt`: it cannot be styled, it is not RTL, and it
 * blocks the polling loop that keeps the board behind it current.
 */

const props = defineProps<{
  open: boolean;
  title: string;
  /** Shown under the title — who this is about, so nobody types blind. */
  subject?: string;
  confirmLabel: string;
  /** Some reasons are genuinely optional; an emergency's never is. */
  required?: boolean;
  placeholder?: string;
}>();

const emit = defineEmits<{
  confirm: [reason: string];
  cancel: [];
}>();

const reason = ref('');
const touched = ref(false);
const field = ref<HTMLTextAreaElement | null>(null);

const invalid = () => props.required === true && reason.value.trim() === '';

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    reason.value = '';
    touched.value = false;
    await nextTick();
    field.value?.focus();
  },
);

function confirm(): void {
  touched.value = true;
  if (invalid()) return;
  emit('confirm', reason.value.trim());
}
</script>

<template>
  <div
    v-if="open"
    class="scrim"
    @click.self="emit('cancel')"
    @keydown.esc="emit('cancel')"
  >
    <div
      class="dcard dcard--pad sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <h2 class="dcard__title">
        {{ title }}
      </h2>
      <p
        v-if="subject"
        class="dmuted sheet__subject"
      >
        {{ subject }}
      </p>

      <label class="dfield">
        <span class="dfield__label">السبب</span>
        <textarea
          ref="field"
          v-model="reason"
          class="dinput sheet__text"
          rows="3"
          maxlength="280"
          :placeholder="placeholder"
          :aria-invalid="touched && invalid() ? 'true' : undefined"
          @blur="touched = true"
        />
      </label>

      <p
        v-if="touched && invalid()"
        class="dnotice dnotice--error"
        role="alert"
      >
        يلزم ذكر السبب.
      </p>

      <div class="sheet__actions">
        <button
          class="dbtn dbtn--ghost"
          type="button"
          @click="emit('cancel')"
        >
          تراجع
        </button>
        <button
          class="dbtn dbtn--primary"
          type="button"
          @click="confirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgb(60 40 34 / 45%);
  display: grid;
  place-items: center;
  padding: 20px;
  z-index: 40;
}

.sheet {
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sheet__subject {
  margin: 0;
  font-size: 13.5px;
}

.sheet__text {
  resize: vertical;
  font-family: var(--ff-body);
}

.sheet__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { ClinicDialog } from '@clinic/client-ui';

/**
 * "Why?" — asked once, properly, before something irreversible or unusual.
 *
 * Marking an emergency, skipping a patient whose grace has not run out, and
 * removing somebody from the queue all change what happens to a family, and
 * each is a decision a colleague may have to explain tomorrow. The reason is
 * stored against the person who acted, so it has to be typed rather than
 * defaulted.
 *
 * The modal itself — scrim, Escape, focus, the page lock — is
 * `ClinicDialog`, shared with the mobile app. What is left here is the one
 * thing that is actually about reasons.
 */

const props = defineProps<{
  open: boolean;
  title: string;
  /** Shown under the title — who this is about, so nobody types blind. */
  subject?: string;
  /**
   * The fact that makes the question worth asking — the clinic's own rule the
   * reason is about to override, stated before anyone types past it.
   */
  message?: string | null;
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
    // After the dialog has taken focus itself, move it to the one field.
    await nextTick();
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
  <clinic-dialog
    :open="open"
    :title="title"
    :subject="subject"
    @close="emit('cancel')"
  >
    <p
      v-if="message"
      class="dnotice"
    >
      {{ message }}
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

    <template #actions>
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
    </template>
  </clinic-dialog>
</template>

<style scoped>
.sheet__text {
  resize: vertical;
  font-family: var(--ff-body);
}
</style>

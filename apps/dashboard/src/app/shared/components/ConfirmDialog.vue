<script setup lang="ts">
import { ClinicDialog } from '@clinic/client-ui';

/**
 * A yes-or-no question that deserved better than `window.confirm`.
 *
 * The browser's own dialog cannot be styled, ignores the page's direction and
 * renders its buttons in the browser's language — so a receptionist ending a
 * clinic day in Arabic was reading "OK / Cancel" in English, left-to-right.
 *
 * `destructive` colours the confirming button rather than changing what it
 * does: the wording still has to say what will happen.
 */

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
  }>(),
  { cancelLabel: 'تراجع', destructive: false },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <clinic-dialog
    :open="open"
    :title="title"
    @close="emit('cancel')"
  >
    <p class="confirm__message">
      {{ message }}
    </p>

    <template #actions>
      <button
        class="dbtn dbtn--ghost"
        type="button"
        @click="emit('cancel')"
      >
        {{ cancelLabel }}
      </button>
      <button
        class="dbtn"
        :class="destructive ? 'dbtn--primary' : 'dbtn--teal'"
        type="button"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </button>
    </template>
  </clinic-dialog>
</template>

<style scoped>
.confirm__message {
  margin: 0;
  line-height: 1.7;
  color: var(--ink-2);
}
</style>

<script setup lang="ts">
/**
 * One sentence, in the right colour, above a form's submit button.
 *
 * Small enough to inline in every page, which is exactly why it should not be:
 * an error a parent cannot see is the same as no error at all, and one shared
 * component keeps every screen's failure state visible and identical.
 */
defineProps<{
  message: string | null;
  tone?: 'error' | 'info' | 'success';
}>();
</script>

<template>
  <p
    v-if="message"
    class="notice"
    :class="`notice--${tone ?? 'error'}`"
    role="alert"
  >
    {{ message }}
  </p>
</template>

<style scoped>
.notice {
  margin: 0;
  padding: 12px 16px;
  border-radius: var(--r-sm);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.7;
  /* Logical, so the accent sits on the correct side under RTL and LTR alike. */
  border-inline-start: 3px solid currentColor;
}

.notice--error {
  color: var(--danger);
  background: #fde6e6;
}

.notice--info {
  color: var(--coral-ink);
  background: var(--coral-soft);
}

.notice--success {
  color: var(--teal-ink);
  background: var(--teal-soft);
}
</style>

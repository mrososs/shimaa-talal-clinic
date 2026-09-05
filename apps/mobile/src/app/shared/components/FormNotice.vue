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
  padding: var(--clinic-space-sm) var(--clinic-space);
  border-radius: var(--clinic-radius-sm);
  font-size: 0.9rem;
  line-height: 1.6;
  /* Logical, so the accent sits on the correct side under RTL and LTR alike. */
  border-inline-start: 3px solid currentColor;
}

.notice--error {
  color: var(--ion-color-danger);
  background: rgba(var(--ion-color-danger-rgb), 0.08);
}

.notice--info {
  color: var(--ion-color-primary);
  background: rgba(var(--ion-color-primary-rgb), 0.08);
}

.notice--success {
  color: var(--ion-color-success);
  background: rgba(var(--ion-color-success-rgb), 0.08);
}
</style>

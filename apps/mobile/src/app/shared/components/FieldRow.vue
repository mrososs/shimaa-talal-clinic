<script setup lang="ts">
import { IonIcon } from '@ionic/vue';

/**
 * A labelled input, shaped like the design's: a bold label above a white
 * rounded row that carries an icon, the field, and optionally a trailing
 * control.
 *
 * A component rather than six copies of the same markup, because the error
 * state is the part everyone forgets — and an error a parent cannot see is the
 * same as no error at all.
 *
 * The `<input>` is a slot rather than a prop-driven `<ion-input>`: these rows
 * hold a plain input, a date field and a password field with a reveal button,
 * and a component that tried to cover all three would grow a prop per variant.
 */
defineProps<{
  label: string;
  icon?: string;
  error?: string | null;
  hint?: string;
}>();
</script>

<template>
  <div class="field">
    <label class="field__label">{{ label }}</label>

    <div
      class="field__row"
      :class="{ 'field__row--error': error }"
    >
      <ion-icon
        v-if="icon"
        class="field__icon"
        :icon="icon"
      />
      <slot />
      <slot name="end" />
    </div>

    <p
      v-if="error"
      class="field__error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="hint"
      class="field__hint"
    >
      {{ hint }}
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.field__label {
  font-size: 13px;
  font-weight: 800;
  color: var(--ink);
}

.field__row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface);
  border: 1.5px solid transparent;
  border-radius: var(--r-md);
  box-shadow: var(--sh-sm);
  padding-inline: 16px;
  min-height: 56px;
}

.field__row:focus-within {
  border-color: var(--coral);
}

.field__row--error {
  border-color: var(--danger);
}

.field__icon {
  font-size: 20px;
  color: var(--muted);
  flex-shrink: 0;
}

/* The slotted control fills the row and brings no chrome of its own. */
.field__row :deep(input) {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--ff-body);
  font-size: 15.5px;
  font-weight: 700;
  color: var(--ink);
  padding-block: 16px;
}

.field__row :deep(input)::placeholder {
  color: var(--muted);
  font-weight: 600;
}

.field__error {
  margin: 0;
  color: var(--danger);
  font-size: 12.5px;
  font-weight: 700;
}

.field__hint {
  margin: 0;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 600;
}
</style>

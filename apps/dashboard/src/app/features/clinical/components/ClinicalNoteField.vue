<script setup lang="ts">
defineProps<{
  title: string;
  placeholder: string;
  modelValue: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <label class="dcard dcard--pad note-field">
    <span class="dcard__title">{{ title }}</span>
    <textarea
      class="note-field__input"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="
        emit(
          'update:modelValue',
          ($event.currentTarget as HTMLTextAreaElement).value,
        )
      "
    />
  </label>
</template>

<style scoped>
.note-field {
  display: grid;
  gap: 10px;
}
.note-field__input {
  width: 100%;
  min-height: 100px;
  border: 1.5px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  color: var(--ink);
  background: var(--surface);
  font: 600 14px/1.7 var(--ff-body);
  resize: vertical;
  outline: none;
}
.note-field__input:focus {
  border-color: var(--teal);
  box-shadow: 0 0 0 3px var(--teal-soft);
}
</style>

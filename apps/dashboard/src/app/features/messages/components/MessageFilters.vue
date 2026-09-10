<script setup lang="ts">
import type { MessageInboxFilter } from '@clinic/contracts';

defineProps<{ modelValue: MessageInboxFilter; unreadCount: number }>();
const emit = defineEmits<{ 'update:modelValue': [value: MessageInboxFilter] }>();

const filters: { value: MessageInboxFilter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'unread', label: 'غير مقروءة' },
  { value: 'open', label: 'المفتوحة' },
  { value: 'urgent', label: 'العاجلة' },
  { value: 'assigned', label: 'المسندة لي' },
];
</script>

<template>
  <div
    class="dtabs filters"
    aria-label="تصفية الرسائل"
  >
    <button
      v-for="item in filters"
      :key="item.value"
      type="button"
      :class="{ on: modelValue === item.value }"
      @click="emit('update:modelValue', item.value)"
    >
      {{ item.label }}
      <span
        v-if="item.value === 'unread' && unreadCount > 0"
        class="filters__count"
      >{{ unreadCount }}</span>
    </button>
  </div>
</template>

<style scoped>
.filters { width: max-content; max-width: 100%; overflow-x: auto; }
.filters__count { display: inline-grid; place-items: center; min-width: 20px; height: 20px; margin-inline-start: 5px; border-radius: 99px; background: var(--coral); color: white; font-size: 11px; }
</style>

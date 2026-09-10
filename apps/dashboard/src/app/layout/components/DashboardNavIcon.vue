<script setup lang="ts">
import type { NavigationIcon } from '../navigation';

defineProps<{ name: NavigationIcon }>();
</script>

<template>
  <svg
    class="nav-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.9"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'overview'">
      <path d="M3.5 10.7 12 3.8l8.5 6.9" />
      <path d="M5.5 9.8v9.4h13V9.8M9.3 19.2v-5.7h5.4v5.7" />
    </template>
    <template v-else-if="name === 'appointments'">
      <rect
        x="3.5"
        y="5.2"
        width="17"
        height="15"
        rx="2.7"
      />
      <path d="M7.8 3.3v3.8M16.2 3.3v3.8M3.5 9.4h17" />
      <path d="M7.4 13h3M13.6 13h3M7.4 16.7h3" />
    </template>
    <template v-else-if="name === 'queue'">
      <circle
        cx="7"
        cy="7"
        r="2.4"
      />
      <circle
        cx="17"
        cy="7"
        r="2.4"
      />
      <circle
        cx="12"
        cy="16.5"
        r="2.4"
      />
      <path
        d="M4 12c.8-1.3 1.8-2 3-2s2.2.7 3 2M14 12c.8-1.3 1.8-2 3-2s2.2.7 3 2M8.7 21c.8-1.3 1.9-2 3.3-2s2.5.7 3.3 2"
      />
    </template>
    <template v-else-if="name === 'patients'">
      <circle
        cx="9"
        cy="8"
        r="3"
      />
      <circle
        cx="17"
        cy="10"
        r="2.2"
      />
      <path d="M3.8 19c.8-3.2 2.5-5 5.2-5s4.4 1.8 5.2 5M14 15c2.8-.4 4.7.9 5.6 3.5" />
    </template>
    <template v-else-if="name === 'messages'">
      <path d="M4.2 5.3h15.6v10.8H9l-4.8 3.1V5.3Z" />
      <path d="M7.6 9h8.8M7.6 12.5h5.8" />
    </template>
    <template v-else-if="name === 'payments'">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="3"
      />
      <path d="M3 9h18M16.5 15.5h1" />
    </template>
    <template v-else-if="name === 'reports'">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </template>
    <template v-else-if="name === 'settings'">
      <circle
        cx="12"
        cy="12"
        r="3"
      />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1A8 8 0 0 0 15 6l-.3-2.5h-4L10.4 6a8 8 0 0 0-1.7 1.1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1A8 8 0 0 0 10.4 18l.3 2.5h4L15 18a8 8 0 0 0 1.7-1.1l2.3 1 2-3.4-2.1-1.5a7 7 0 0 0 .1-1Z" />
    </template>
    <template v-else>
      <rect
        x="4"
        y="3.8"
        width="16"
        height="16.4"
        rx="3"
      />
      <path d="M12 8v8M8 12h8" />
    </template>
  </svg>
</template>

<style scoped>
.nav-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
}
</style>

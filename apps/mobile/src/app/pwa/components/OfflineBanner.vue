<script setup lang="ts">
defineProps<{ visible: boolean }>();
</script>

<template>
  <aside v-if="visible" class="status-banner status-banner--offline" role="status">
    لا يوجد اتصال بالإنترنت. الحجز والطابور وباقي العمليات تحتاج إلى اتصال.
  </aside>
</template>

<style scoped>
.status-banner {
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, var(--warn) 38%, white);
  border-radius: var(--r-md);
  background: var(--sun-soft);
  color: var(--ink);
  box-shadow: var(--sh-md);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.55;
}
</style>


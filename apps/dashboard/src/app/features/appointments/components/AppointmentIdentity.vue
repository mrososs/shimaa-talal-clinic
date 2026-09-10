<script setup lang="ts">
import type { ChildSummary, GuardianSummary } from '@clinic/contracts';

defineProps<{
  child: ChildSummary;
  guardian: GuardianSummary;
}>();
</script>

<template>
  <div class="identity">
    <strong class="identity__child">{{ child.fullName }}</strong>
    <span class="identity__guardian">ولي الأمر: {{ guardian.fullName }}</span>
  </div>
</template>

<style scoped>
.identity {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.identity__child {
  overflow: hidden;
  color: var(--ink-1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity__guardian {
  overflow: hidden;
  color: var(--ink-2);
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

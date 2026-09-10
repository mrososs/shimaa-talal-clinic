<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  todayLabel: string;
}>();
</script>

<template>
  <header class="dash-top">
    <div class="dash-top__title">
      <h1>{{ title }}</h1>
      <p v-if="subtitle">
        {{ subtitle }}
      </p>
    </div>
    <span class="dpill dash-top__today">
      <span
        class="dpill__dot"
        aria-hidden="true"
      />
      {{ todayLabel }}
    </span>
  </header>
</template>

<style scoped>
.dash-top__today {
  margin-inline-start: auto;
  color: var(--teal-ink);
  background: var(--teal-soft);
}

@media (max-width: 560px) {
  .dash-top {
    align-items: flex-start;
    flex-direction: column;
  }

  .dash-top__today {
    margin-inline-start: 0;
  }
}
</style>

<script setup lang="ts">
defineProps<{ updating: boolean }>();

defineEmits<{
  update: [];
  dismiss: [];
}>();
</script>

<template>
  <aside class="update-banner" role="status">
    <p class="update-banner__message">يتوفر تحديث جديد للتطبيق.</p>
    <button
      type="button"
      class="update-banner__action"
      :disabled="updating"
      @click="$emit('update')"
    >
      {{ updating ? 'جارٍ التحديث…' : 'تحديث' }}
    </button>
    <button
      type="button"
      class="update-banner__dismiss"
      aria-label="تأجيل التحديث"
      @click="$emit('dismiss')"
    >
      لاحقًا
    </button>
  </aside>
</template>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, var(--teal) 30%, white);
  border-radius: var(--r-md);
  background: var(--teal-soft);
  box-shadow: var(--sh-md);
}

.update-banner__message {
  flex: 1;
  margin: 0;
  color: var(--teal-ink);
  font-size: 13px;
  font-weight: 800;
}

.update-banner__action,
.update-banner__dismiss {
  min-inline-size: 44px;
  min-block-size: 44px;
  border: 0;
  border-radius: var(--r-pill);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.update-banner__action {
  padding-inline: 14px;
  background: var(--teal);
  color: white;
}

.update-banner__dismiss {
  padding-inline: 8px;
  background: transparent;
  color: var(--teal-ink);
}
</style>


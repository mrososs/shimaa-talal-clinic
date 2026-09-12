<script setup lang="ts">
import type { InstallPlatform } from '../composables/usePwaInstall';

defineProps<{
  platform: InstallPlatform;
  prompting: boolean;
}>();

defineEmits<{
  install: [];
  dismiss: [];
}>();
</script>

<template>
  <aside v-if="platform" class="install-banner" aria-label="تثبيت التطبيق">
    <div class="install-banner__copy">
      <strong>ثبّتي تطبيق العيادة</strong>
      <span v-if="platform === 'ios'">
        من زر المشاركة اختاري «إضافة إلى الشاشة الرئيسية».
      </span>
      <span v-else>افتحيه من الشاشة الرئيسية بسهولة في المرة القادمة.</span>
    </div>
    <button
      v-if="platform === 'browser'"
      type="button"
      class="install-banner__action"
      :disabled="prompting"
      @click="$emit('install')"
    >
      {{ prompting ? 'جارٍ التثبيت…' : 'تثبيت التطبيق' }}
    </button>
    <button
      type="button"
      class="install-banner__dismiss"
      aria-label="إخفاء اقتراح التثبيت"
      @click="$emit('dismiss')"
    >
      لاحقًا
    </button>
  </aside>
</template>

<style scoped>
.install-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--sh-md);
}

.install-banner__copy {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-2);
}

.install-banner__copy strong {
  color: var(--ink);
  font-family: var(--ff-display);
  font-size: 14px;
}

.install-banner__action,
.install-banner__dismiss {
  min-inline-size: 44px;
  min-block-size: 44px;
  border: 0;
  border-radius: var(--r-pill);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.install-banner__action {
  padding-inline: 14px;
  background: var(--coral);
  color: white;
}

.install-banner__dismiss {
  padding-inline: 8px;
  background: transparent;
  color: var(--ink-2);
}

@media (max-width: 390px) {
  .install-banner {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .install-banner__copy {
    flex-basis: 100%;
  }
}
</style>


<script setup lang="ts">
import type { Guardian } from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';

defineProps<{
  families: readonly Guardian[];
  selectedId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
}>();

const emit = defineEmits<{ select: [guardianId: string]; more: [] }>();
</script>

<template>
  <section class="dcard directory">
    <header class="dcard__head">
      <h2 class="dcard__title">
        العائلات
      </h2>
      <span class="dpill">{{ arabicDigits(families.length) }}</span>
    </header>

    <p
      v-if="loading"
      class="dcard--pad dmuted centre"
    >
      جارٍ البحث…
    </p>
    <p
      v-else-if="families.length === 0"
      class="dcard--pad dmuted centre"
    >
      لا توجد عائلة مطابقة.
    </p>
    <div
      v-else
      class="directory__list"
    >
      <button
        v-for="family in families"
        :key="family.id"
        type="button"
        class="directory__item"
        :class="{ 'directory__item--active': family.id === selectedId }"
        @click="emit('select', family.id)"
      >
        <span class="directory__avatar">{{ family.fullName.slice(0, 1) }}</span>
        <span class="directory__identity">
          <strong>{{ family.fullName }}</strong>
          <span dir="ltr">{{ family.phoneE164 }}</span>
        </span>
        <span
          v-if="family.hasAccount"
          class="dpill dpill--ok"
        >مرتبط</span>
        <span
          v-else
          class="dpill"
        >بدون حساب</span>
      </button>
      <button
        v-if="hasMore"
        class="dbtn dbtn--ghost directory__more"
        type="button"
        :disabled="loadingMore"
        @click="emit('more')"
      >
        {{ loadingMore ? 'جارٍ تحميل المزيد…' : 'عرض المزيد' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.centre { text-align: center; }
.directory { overflow: hidden; }
.directory__list { display: grid; }
.directory__item { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; border: 0; border-top: 1px solid var(--line); color: var(--ink); background: transparent; font-family: var(--ff-body); text-align: start; cursor: pointer; }
.directory__item:hover, .directory__item--active { background: var(--surface-2); }
.directory__item--active { box-shadow: inset -3px 0 var(--coral); }
.directory__avatar { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 14px; color: #7d4139; background: var(--coral-soft); font-family: var(--ff-display); font-size: 18px; font-weight: 800; }
.directory__identity { display: flex; flex-direction: column; min-width: 0; }
.directory__identity strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.directory__identity span { color: var(--muted); font-size: 12.5px; text-align: right; }
.directory__more { margin: 12px; }
</style>

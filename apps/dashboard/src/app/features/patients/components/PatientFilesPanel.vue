<script setup lang="ts">
import type { PatientFile } from '@clinic/contracts';

defineProps<{
  childName: string;
  files: PatientFile[];
  loading: boolean;
  uploading: boolean;
}>();

const emit = defineEmits<{ upload: []; download: [fileId: string] }>();

function fileKind(mimeType: string): string {
  return mimeType === 'application/pdf' ? 'PDF' : 'صورة';
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} ك.ب`
    : `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}
</script>

<template>
  <section class="dcard files-panel">
    <header class="files-panel__header">
      <div>
        <span class="dmuted">المستندات الطبية</span>
        <h2>ملفات {{ childName }}</h2>
      </div>
      <button
        class="dbtn dbtn--primary dbtn--sm"
        type="button"
        :disabled="uploading"
        @click="emit('upload')"
      >
        {{ uploading ? 'جارٍ الرفع…' : 'رفع ملف' }}
      </button>
    </header>

    <p
      v-if="loading"
      class="files-panel__state dmuted"
    >
      جارٍ تحميل الملفات…
    </p>
    <div
      v-else-if="files.length"
      class="files-panel__list"
    >
      <article
        v-for="file in files"
        :key="file.id"
        class="file-row"
      >
        <span
          class="file-row__icon"
          aria-hidden="true"
        >{{
          fileKind(file.mimeType)
        }}</span>
        <div class="file-row__body">
          <strong>{{ file.fileName }}</strong>
          <p class="dmuted">
            {{ fileSize(file.sizeBytes) }}
          </p>
        </div>
        <button
          class="dbtn dbtn--ghost dbtn--sm"
          type="button"
          @click="emit('download', file.id)"
        >
          فتح
        </button>
      </article>
    </div>
    <div
      v-else
      class="files-panel__state"
    >
      <strong>لا توجد ملفات مرفوعة</strong>
      <p class="dmuted">
        يمكن رفع تقارير PDF أو صور JPG وPNG وWebP حتى 10 م.ب.
      </p>
    </div>
  </section>
</template>

<style scoped>
.files-panel {
  overflow: hidden;
}
.files-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
}
.files-panel__header h2 {
  margin: 2px 0 0;
  font-family: var(--ff-display);
  font-size: 21px;
}
.files-panel__list {
  display: grid;
  gap: 8px;
  padding: 0 20px 20px;
}
.files-panel__state {
  margin: 0;
  padding: 22px 20px;
  border-top: 1px solid var(--line);
  text-align: center;
}
.files-panel__state p {
  margin: 5px 0 0;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 13px;
}
.file-row__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 34px;
  border-radius: 10px;
  color: var(--teal-ink);
  background: var(--teal-soft);
  font-size: 11px;
  font-weight: 800;
}
.file-row__body {
  min-width: 0;
  flex: 1;
}
.file-row__body strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-row__body p {
  margin: 2px 0 0;
  font-size: 12px;
}
@media (max-width: 520px) {
  .files-panel__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

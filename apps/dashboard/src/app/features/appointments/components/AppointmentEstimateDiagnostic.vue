<script setup lang="ts">
import type { StaffEstimateDiagnostic } from '@clinic/contracts';

defineProps<{ diagnostic: StaffEstimateDiagnostic; timezone: string }>();
defineEmits<{ close: [] }>();
const time = (value?: string | null, timezone = 'Africa/Cairo') => value
  ? new Intl.DateTimeFormat('ar-EG', {
      hour: 'numeric', minute: '2-digit', timeZone: timezone,
    }).format(new Date(value))
  : '—';
</script>

<template>
  <aside class="dcard dcard--pad diagnostic" aria-labelledby="estimate-diagnostic-title">
    <header class="diagnostic__head">
      <div>
        <h2 id="estimate-diagnostic-title">تشخيص تقدير الموعد</h2>
        <p class="dmuted">التقدير التشغيلي الآن مقابل المعروض للأسرة</p>
      </div>
      <button class="dbtn dbtn--ghost" type="button" @click="$emit('close')">إغلاق</button>
    </header>
    <div class="diagnostic__grid">
      <div><span>التشغيلي الآن</span><strong>{{ time(diagnostic.rawEstimate?.consultationFrom, timezone) }}</strong></div>
      <div><span>المعروض للأسرة</span><strong>{{ time(diagnostic.publishedEstimate?.consultationFrom, timezone) }}</strong></div>
      <div><span>الانحراف الخام</span><strong>{{ diagnostic.rawDriftMinutes ?? '—' }} دقيقة</strong></div>
      <div><span>الثقة</span><strong>{{ diagnostic.confidence ?? 'غير متاح' }}</strong></div>
      <div><span>مؤكد قبله</span><strong>{{ diagnostic.confirmedAheadCount }}</strong></div>
      <div><span>طلبات غير مؤكدة</span><strong>{{ diagnostic.requestedAheadCount }}</strong></div>
      <div><span>عينات الجلسة</span><strong>{{ diagnostic.paceSampleCount }}</strong></div>
      <div><span>مصدر خط الأساس</span><strong>{{ diagnostic.baselineSource }}</strong></div>
    </div>
    <p v-if="diagnostic.unavailableReason" class="dnotice dnotice--error">
      {{ diagnostic.unavailableReason === 'doctor_start_unknown'
        ? 'الطبيبة لم تصل بعد، ووقت البدء المتوقع غير محدد.'
        : diagnostic.unavailableReason }}
    </p>
    <ul v-if="diagnostic.confidenceReasons.length" class="dmuted">
      <li v-for="reason in diagnostic.confidenceReasons" :key="reason">{{ reason }}</li>
    </ul>
  </aside>
</template>

<style scoped>
.diagnostic { position: sticky; top: 16px; z-index: 2; }
.diagnostic__head { display: flex; justify-content: space-between; gap: 16px; }
.diagnostic__head h2, .diagnostic__head p { margin: 0; }
.diagnostic__grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-top: 16px; }
.diagnostic__grid div { display: grid; gap: 4px; padding: 10px; background: var(--surface-soft); border-radius: 10px; }
.diagnostic__grid span { color: var(--ink-2); font-size: 12px; }
@media (max-width: 900px) { .diagnostic__grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
</style>

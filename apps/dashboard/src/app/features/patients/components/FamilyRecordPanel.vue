<script setup lang="ts">
import { computed } from 'vue';
import {
  AppointmentStatus,
  type FamilyVisitSummary,
  type StaffFamilyRecord,
} from '@clinic/contracts';
import { ageLabel, windowLabel } from '../../../shared/format';

const props = defineProps<{
  record: StaffFamilyRecord | null;
  loading: boolean;
  timezone: string;
  canManage: boolean;
  selectedChildId?: string | null;
}>();

const emit = defineEmits<{
  addChild: [];
  issueClaim: [];
  selectChild: [childId: string];
}>();

const childNames = computed(
  () =>
    new Map(
      props.record?.children.map((child) => [child.id, child.fullName]) ?? [],
    ),
);

const VISIT: Record<string, string> = {
  new_visit: 'كشف جديد',
  follow_up: 'متابعة',
  vaccination: 'تطعيم',
  consultation: 'استشارة',
  newborn: 'حديث ولادة',
};
const STATUS: Record<string, string> = {
  requested: 'بانتظار الموافقة',
  confirmed: 'مؤكد',
  checked_in: 'وصل',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  no_show: 'لم يحضر',
};

function visitTone(visit: FamilyVisitSummary): string {
  if (visit.status === AppointmentStatus.Completed) return 'dpill--ok';
  if (visit.status === AppointmentStatus.NoShow) return 'dpill--warn';
  return '';
}
</script>

<template>
  <section class="dcard record">
    <p
      v-if="loading"
      class="dcard--pad dmuted centre"
    >
      جارٍ فتح الملف…
    </p>
    <div
      v-else-if="record === null"
      class="record__empty"
    >
      <span class="record__empty-icon">♡</span>
      <h2>اختاري عائلة</h2>
      <p class="dmuted">
        ستظهر بيانات الأطفال والزيارات هنا بدون أي ملاحظات طبية.
      </p>
    </div>
    <template v-else>
      <header class="record__hero">
        <div>
          <span class="dmuted">ملف العائلة</span>
          <h2>{{ record.guardian.fullName }}</h2>
          <p dir="ltr">
            {{ record.guardian.phoneE164 }}
          </p>
        </div>
        <div
          v-if="canManage"
          class="drow"
        >
          <button
            class="dbtn dbtn--ghost dbtn--sm"
            type="button"
            @click="emit('addChild')"
          >
            إضافة طفل
          </button>
          <button
            v-if="!record.guardian.hasAccount"
            class="dbtn dbtn--primary dbtn--sm"
            type="button"
            @click="emit('issueClaim')"
          >
            إصدار رمز ربط
          </button>
        </div>
      </header>

      <div class="record__section">
        <h3>الأطفال</h3>
        <div class="children">
          <button
            v-for="child in record.children"
            :key="child.id"
            class="child-card"
            :class="{ 'child-card--selected': child.id === selectedChildId }"
            type="button"
            @click="emit('selectChild', child.id)"
          >
            <span class="child-card__avatar">{{
              child.fullName.slice(0, 1)
            }}</span>
            <div>
              <strong>{{ child.fullName }}</strong>
              <p class="dmuted">
                {{ ageLabel(child.dateOfBirth) ?? 'العمر غير مسجل' }}
              </p>
            </div>
            <span
              v-if="child.isPrimary"
              class="dpill dpill--ok"
            >أساسي</span>
          </button>
          <p
            v-if="record.children.length === 0"
            class="dmuted"
          >
            لا يوجد أطفال مسجلون.
          </p>
        </div>
      </div>

      <div class="record__section">
        <h3>الزيارات القادمة</h3>
        <div class="visits">
          <article
            v-for="visit in record.upcomingVisits"
            :key="visit.id"
            class="visit"
          >
            <div>
              <strong>{{ childNames.get(visit.childId) ?? 'طفل' }}</strong>
              <p>
                {{ VISIT[visit.visitType] ?? visit.visitType }} ·
                {{ windowLabel(visit.windowStart, visit.windowEnd, timezone) }}
              </p>
            </div>
            <span class="dpill">{{
              STATUS[visit.status] ?? visit.status
            }}</span>
          </article>
          <p
            v-if="record.upcomingVisits.length === 0"
            class="dmuted"
          >
            لا توجد زيارات قادمة.
          </p>
        </div>
      </div>

      <div class="record__section">
        <h3>سجل الزيارات</h3>
        <div class="visits">
          <article
            v-for="visit in record.pastVisits"
            :key="visit.id"
            class="visit"
          >
            <div>
              <strong>{{ childNames.get(visit.childId) ?? 'طفل' }}</strong>
              <p>
                {{ VISIT[visit.visitType] ?? visit.visitType }} ·
                {{ windowLabel(visit.windowStart, visit.windowEnd, timezone) }}
              </p>
            </div>
            <span
              class="dpill"
              :class="visitTone(visit)"
            >{{
              STATUS[visit.status] ?? visit.status
            }}</span>
          </article>
          <p
            v-if="record.pastVisits.length === 0"
            class="dmuted"
          >
            لا يوجد سجل زيارات بعد.
          </p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.centre {
  text-align: center;
}
.record {
  min-height: 480px;
  overflow: hidden;
}
.record__empty {
  display: grid;
  place-items: center;
  align-content: center;
  min-height: 470px;
  padding: 30px;
  text-align: center;
}
.record__empty h2,
.record__empty p {
  margin: 0;
}
.record__empty-icon {
  color: var(--coral);
  font-size: 54px;
}
.record__hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: linear-gradient(135deg, var(--coral-soft), var(--surface));
}
.record__hero h2 {
  margin: 2px 0;
  font-family: var(--ff-display);
  font-size: 26px;
}
.record__hero p {
  margin: 0;
  color: var(--muted);
  text-align: right;
}
.record__section {
  padding: 18px 20px;
  border-top: 1px solid var(--line);
}
.record__section h3 {
  margin: 0 0 12px;
  font-family: var(--ff-display);
}
.children {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.child-card {
  display: grid;
  width: 100%;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 11px;
  border: 1px solid var(--line);
  border-radius: 14px;
  color: inherit;
  background: var(--surface-2);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.child-card:hover {
  border-color: var(--teal);
}
.child-card--selected {
  border-color: var(--teal);
  box-shadow: 0 0 0 2px var(--teal-soft);
}
.child-card__avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  color: var(--teal-ink);
  background: var(--teal-soft);
  font-family: var(--ff-display);
  font-weight: 800;
}
.child-card p,
.visit p {
  margin: 1px 0 0;
  font-size: 12.5px;
}
.visits {
  display: grid;
  gap: 8px;
}
.visit {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 13px;
}
@media (max-width: 720px) {
  .record__hero {
    align-items: flex-start;
    flex-direction: column;
  }
  .children {
    grid-template-columns: 1fr;
  }
}
</style>

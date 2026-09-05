<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  VisitType,
  type AvailabilityDay,
  type AvailabilityWindow,
  type Guardian,
  type GuardianChild,
} from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { arabicDigits } from '../../../shared/numerals';
import { clinicApi, session } from '../../../runtime';

/**
 * Reception's booking desk: find the family, or create it, then book.
 *
 * The whole flow is one page because it is one phone call. A wizard across
 * routes would mean a receptionist loses their place every time the caller says
 * something unexpected — and they always do.
 *
 * It works for a family with no app and no account, which is the load-bearing
 * requirement: mobile adoption must never be required for the clinic to
 * operate. A guardian created here has no `auth_user_id` and is bookable
 * immediately.
 */

const REASONS = [
  { value: VisitType.NewVisit, label: 'كشف جديد' },
  { value: VisitType.FollowUp, label: 'متابعة' },
  { value: VisitType.Vaccination, label: 'تطعيم' },
  { value: VisitType.Consultation, label: 'استشارة' },
  { value: VisitType.Newborn, label: 'حديث الولادة' },
] as const;

const state = session.state;
const timezone = computed(
  () => state.identity?.clinic.timezone ?? 'Africa/Cairo',
);

const search = ref('');
const results = ref<Guardian[] | null>(null);
const guardian = ref<Guardian | null>(null);
const children = ref<GuardianChild[]>([]);
const childId = ref<string | null>(null);

const days = ref<AvailabilityDay[]>([]);
const selectedDate = ref<string | null>(null);
const selectedWindow = ref<AvailabilityWindow | null>(null);
const visitType = ref<VisitType>(VisitType.NewVisit);

const busy = ref(false);
const failure = ref<string | null>(null);
const success = ref<string | null>(null);

/** Shown only when a search found nothing — the clinic has not met them. */
const newGuardian = ref({ fullName: '', phone: '' });
const newChild = ref({ fullName: '', dateOfBirth: '' });

const windowsForDay = computed(
  () => days.value.find((day) => day.date === selectedDate.value)?.windows ?? [],
);
const canBook = computed(
  () =>
    guardian.value !== null &&
    childId.value !== null &&
    selectedWindow.value !== null &&
    !busy.value,
);

function windowLabel(window: AvailabilityWindow): string {
  const format = new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone.value,
  });
  return `${format.format(new Date(window.windowStart))} – ${format.format(
    new Date(window.windowEnd),
  )}`;
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone.value,
  }).format(new Date(`${date}T12:00:00Z`));
}

async function runSearch(): Promise<void> {
  const term = search.value.trim();
  if (term === '') return;

  busy.value = true;
  failure.value = null;
  success.value = null;
  try {
    // A number goes to the phone lookup, anything else to the name search.
    const numeric = /^[\d\s+-]+$/.test(term);
    const page = await clinicApi.searchGuardians(
      numeric ? { phone: term } : { q: term },
    );
    results.value = page.items;
    if (numeric) newGuardian.value.phone = term;
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    busy.value = false;
  }
}

async function choose(found: Guardian): Promise<void> {
  busy.value = true;
  failure.value = null;
  try {
    const detail = await clinicApi.guardian(found.id);
    guardian.value = detail.guardian;
    children.value = detail.children;
    childId.value = detail.children[0]?.id ?? null;
    results.value = null;
    await loadAvailability();
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    busy.value = false;
  }
}

async function createGuardian(): Promise<void> {
  busy.value = true;
  failure.value = null;
  try {
    const created = await clinicApi.createGuardian({
      fullName: newGuardian.value.fullName.trim(),
      phone: newGuardian.value.phone.trim(),
    });
    guardian.value = created;
    children.value = [];
    childId.value = null;
    results.value = null;
    await loadAvailability();
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    busy.value = false;
  }
}

async function createChild(): Promise<void> {
  if (guardian.value === null) return;
  busy.value = true;
  failure.value = null;
  try {
    const created = await clinicApi.createChild(guardian.value.id, {
      fullName: newChild.value.fullName.trim(),
      ...(newChild.value.dateOfBirth
        ? { dateOfBirth: newChild.value.dateOfBirth }
        : {}),
    });
    children.value = [...children.value, created];
    childId.value = created.id;
    newChild.value = { fullName: '', dateOfBirth: '' };
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    busy.value = false;
  }
}

async function loadAvailability(): Promise<void> {
  days.value = await clinicApi.availability();
  selectedDate.value = days.value[0]?.date ?? null;
  selectedWindow.value = null;
}

function pickDay(date: string): void {
  selectedDate.value = date;
  selectedWindow.value = null;
}

async function book(): Promise<void> {
  if (!canBook.value || guardian.value === null || childId.value === null) {
    return;
  }
  const window = selectedWindow.value;
  if (window === null) return;

  busy.value = true;
  failure.value = null;
  try {
    await clinicApi.book({
      guardianId: guardian.value.id,
      childId: childId.value,
      sessionId: window.sessionId,
      windowStart: window.windowStart,
      visitType: visitType.value,
    });
    success.value = `تم الحجز — ${windowLabel(window)}`;
    selectedWindow.value = null;
    // The count on screen is now one lower; re-read rather than guess.
    await loadAvailability();
  } catch (error) {
    failure.value = apiMessage(error);
    await loadAvailability();
  } finally {
    busy.value = false;
  }
}

function startOver(): void {
  guardian.value = null;
  children.value = [];
  childId.value = null;
  results.value = null;
  search.value = '';
  success.value = null;
  failure.value = null;
}
</script>

<template>
  <div class="dstack">
    <p
      v-if="failure"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ failure }}
    </p>
    <p
      v-if="success"
      class="dnotice dnotice--ok"
      role="status"
    >
      {{ success }}
    </p>

    <!-- 1. The family -->
    <section class="dcard">
      <header class="dcard__head">
        <h2 class="dcard__title">
          ١ · العائلة
        </h2>
        <button
          v-if="guardian"
          class="dbtn dbtn--ghost dbtn--sm"
          @click="startOver"
        >
          بحث جديد
        </button>
      </header>

      <div class="dcard--pad dstack">
        <template v-if="guardian === null">
          <form
            class="drow"
            @submit.prevent="runSearch"
          >
            <input
              v-model="search"
              class="dinput"
              placeholder="رقم الهاتف أو اسم ولي الأمر"
            >
            <button
              class="dbtn dbtn--primary"
              :disabled="busy"
              type="submit"
            >
              بحث
            </button>
          </form>

          <div
            v-if="results && results.length > 0"
            class="dstack results"
          >
            <button
              v-for="found in results"
              :key="found.id"
              class="dcard dcard--pad result"
              @click="choose(found)"
            >
              <span class="result__name">{{ found.fullName }}</span>
              <span
                class="result__phone"
                dir="ltr"
              >{{ found.phoneE164 }}</span>
              <span
                v-if="!found.hasAccount"
                class="dpill"
              >بدون تطبيق</span>
            </button>
          </div>

          <!-- Nothing found: the clinic has not met this family yet. -->
          <div
            v-else-if="results"
            class="dstack"
          >
            <p class="dmuted">
              لا يوجد ملف بهذا البحث. أنشئي ملفاً جديداً:
            </p>
            <div class="grid-2">
              <label class="dfield">
                <span class="dfield__label">اسم ولي الأمر</span>
                <input
                  v-model="newGuardian.fullName"
                  class="dinput"
                >
              </label>
              <label class="dfield">
                <span class="dfield__label">رقم الهاتف</span>
                <input
                  v-model="newGuardian.phone"
                  class="dinput"
                  dir="ltr"
                >
              </label>
            </div>
            <button
              class="dbtn dbtn--primary"
              :disabled="busy || newGuardian.fullName.trim().length < 2"
              @click="createGuardian"
            >
              إنشاء الملف
            </button>
          </div>
        </template>

        <div
          v-else
          class="drow chosen"
        >
          <span class="result__name">{{ guardian.fullName }}</span>
          <span
            class="result__phone"
            dir="ltr"
          >{{ guardian.phoneE164 }}</span>
        </div>
      </div>
    </section>

    <!-- 2. The child -->
    <section
      v-if="guardian"
      class="dcard"
    >
      <header class="dcard__head">
        <h2 class="dcard__title">
          ٢ · الطفل
        </h2>
      </header>

      <div class="dcard--pad dstack">
        <div
          v-if="children.length > 0"
          class="dtabs chips"
        >
          <button
            v-for="child in children"
            :key="child.id"
            :class="{ on: childId === child.id }"
            @click="childId = child.id"
          >
            {{ child.fullName }}
          </button>
        </div>

        <div class="grid-2">
          <label class="dfield">
            <span class="dfield__label">إضافة طفل</span>
            <input
              v-model="newChild.fullName"
              class="dinput"
              placeholder="اسم الطفل"
            >
          </label>
          <label class="dfield">
            <span class="dfield__label">تاريخ الميلاد (اختياري)</span>
            <input
              v-model="newChild.dateOfBirth"
              class="dinput"
              type="date"
            >
          </label>
        </div>
        <button
          class="dbtn dbtn--ghost"
          :disabled="busy || newChild.fullName.trim() === ''"
          @click="createChild"
        >
          إضافة
        </button>
      </div>
    </section>

    <!-- 3. When -->
    <section
      v-if="guardian && childId"
      class="dcard"
    >
      <header class="dcard__head">
        <h2 class="dcard__title">
          ٣ · فترة الحضور
        </h2>
      </header>

      <div class="dcard--pad dstack">
        <div class="dtabs days">
          <button
            v-for="day in days"
            :key="day.date"
            :class="{ on: selectedDate === day.date }"
            @click="pickDay(day.date)"
          >
            {{ dayLabel(day.date) }}
          </button>
        </div>

        <div class="windows">
          <button
            v-for="window in windowsForDay"
            :key="window.windowStart"
            class="dcard window"
            :class="{
              'window--on': selectedWindow?.windowStart === window.windowStart,
              'window--full': window.remaining === 0,
            }"
            :disabled="window.remaining === 0"
            @click="selectedWindow = window"
          >
            <span class="window__time">{{ windowLabel(window) }}</span>
            <span class="window__left">
              {{ arabicDigits(window.remaining) }}/{{
                arabicDigits(window.capacity)
              }}
            </span>
          </button>
        </div>

        <div class="dtabs chips">
          <button
            v-for="reason in REASONS"
            :key="reason.value"
            :class="{ on: visitType === reason.value }"
            @click="visitType = reason.value"
          >
            {{ reason.label }}
          </button>
        </div>

        <button
          class="dbtn dbtn--primary dbtn--block"
          :disabled="!canBook"
          @click="book"
        >
          تأكيد الحجز
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.results {
  gap: 8px;
}

.result {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  text-align: start;
  font: inherit;
  color: inherit;
}

.result__name {
  font-weight: 800;
  flex: 1;
}

.result__phone {
  color: var(--ink-2);
  font-weight: 700;
}

.chosen {
  gap: 14px;
}

.chips,
.days {
  flex-wrap: wrap;
}

.windows {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}

.window {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  cursor: pointer;
  font: inherit;
  color: inherit;
  border: 1.5px solid var(--line);
}

.window--on {
  border-color: var(--coral);
  background: var(--coral-soft);
}

.window--full {
  opacity: 0.5;
  cursor: not-allowed;
}

.window__time {
  font-family: var(--ff-display);
  font-weight: 800;
}

.window__left {
  font-weight: 800;
  font-size: 13px;
  color: var(--ink-2);
}
</style>

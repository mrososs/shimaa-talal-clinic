<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonIcon, IonSpinner, onIonViewWillEnter } from '@ionic/vue';
import {
  addOutline,
  chatbubblesOutline,
  checkmarkOutline,
  medkitOutline,
  walletOutline,
} from 'ionicons/icons';
import {
  VisitType,
  type AvailabilityDay,
  type AvailabilityWindow,
  type GuardianChild,
} from '@clinic/contracts';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { dayLabel, remainingLabel, windowLabel } from '../../../shared/format';
import { apiMessage } from '../../../shared/messages';
import { arabicDigits } from '../../../shared/numerals';
import { bookingApi, session } from '../../../runtime';

const REASONS = [
  { value: VisitType.NewVisit, label: 'كشف عام' },
  { value: VisitType.FollowUp, label: 'متابعة' },
  { value: VisitType.Vaccination, label: 'تطعيم' },
  { value: VisitType.Consultation, label: 'استشارة' },
  { value: VisitType.Newborn, label: 'حديثو الولادة' },
] as const;

const router = useRouter();
const state = session.state;
const days = ref<AvailabilityDay[]>([]);
const loading = ref(true);
const submitting = ref(false);
const failure = ref<string | null>(null);
const childId = ref<string | null>(null);
const selectedDate = ref<string | null>(null);
const selectedWindow = ref<AvailabilityWindow | null>(null);
const visitType = ref<VisitType>(VisitType.NewVisit);

const children = computed<readonly GuardianChild[]>(
  () => state.identity?.children ?? [],
);
const timezone = computed(() => state.identity?.clinic.timezone);
const windowsForDay = computed(
  () =>
    days.value.find((day) => day.date === selectedDate.value)?.windows ?? [],
);
const consultation = computed(() => visitType.value === VisitType.Consultation);
const canConfirm = computed(
  () =>
    childId.value !== null &&
    selectedWindow.value !== null &&
    !submitting.value,
);

async function load(): Promise<void> {
  loading.value = true;
  failure.value = null;
  try {
    days.value = await bookingApi.availability();
    selectedDate.value ??= days.value[0]?.date ?? null;
    childId.value ??= children.value[0]?.id ?? null;
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    loading.value = false;
  }
}

function pickMode(mode: 'visit' | 'consultation'): void {
  if (mode === 'consultation') {
    visitType.value = VisitType.Consultation;
  } else if (consultation.value) {
    visitType.value = VisitType.NewVisit;
  }
}

function pickDay(date: string): void {
  selectedDate.value = date;
  selectedWindow.value = null;
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'short',
    timeZone: timezone.value ?? 'Africa/Cairo',
  }).format(new Date(`${date}T12:00:00Z`));
}

function childAge(child: GuardianChild): string {
  if (!child.dateOfBirth) return 'طفلك';
  const born = new Date(`${child.dateOfBirth}T12:00:00Z`);
  const now = new Date();
  const months = Math.max(
    0,
    (now.getUTCFullYear() - born.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      born.getUTCMonth(),
  );
  return months < 24
    ? `${arabicDigits(months)} شهر`
    : `${arabicDigits(Math.floor(months / 12))} سنوات`;
}

async function confirm(): Promise<void> {
  if (!canConfirm.value || childId.value === null || !selectedWindow.value) {
    return;
  }
  submitting.value = true;
  failure.value = null;
  try {
    const appointment = await bookingApi.book({
      childId: childId.value,
      sessionId: selectedWindow.value.sessionId,
      windowStart: selectedWindow.value.windowStart,
      visitType: visitType.value,
    });
    await router.replace({
      name: 'payments',
      query: { appointmentId: appointment.id },
    });
  } catch (error) {
    failure.value = apiMessage(error);
    selectedWindow.value = null;
    await load();
  } finally {
    submitting.value = false;
  }
}

onIonViewWillEnter(() => void load());
</script>

<template>
  <screen-shell
    title="حجز موعد"
    subtitle="استشارة أو كشف في العيادة"
    :back-to="{ name: 'home' }"
  >
    <div v-if="loading" class="card centre">
      <ion-spinner name="crescent" />
    </div>

    <div v-else class="booking">
      <form-notice :message="failure" />

      <section class="booking__section">
        <h2 class="section-title">نوع الحجز</h2>
        <div class="mode-grid">
          <button
            type="button"
            class="card mode"
            :class="{ 'mode--selected': !consultation }"
            :aria-pressed="!consultation"
            @click="pickMode('visit')"
          >
            <span class="mode__top">
              <span class="mode__icon mode__icon--coral">
                <ion-icon :icon="medkitOutline" />
              </span>
              <span class="mode__check">
                <ion-icon v-if="!consultation" :icon="checkmarkOutline" />
              </span>
            </span>
            <strong>كشف في العيادة</strong>
            <small>زيارة العيادة مع متابعة الدور</small>
            <b>السعر يظهر في الدفع</b>
          </button>
          <button
            type="button"
            class="card mode"
            :class="{ 'mode--selected': consultation }"
            :aria-pressed="consultation"
            @click="pickMode('consultation')"
          >
            <span class="mode__top">
              <span class="mode__icon mode__icon--lav">
                <ion-icon :icon="chatbubblesOutline" />
              </span>
              <span class="mode__check">
                <ion-icon v-if="consultation" :icon="checkmarkOutline" />
              </span>
            </span>
            <strong>استشارة</strong>
            <small>جلسة استشارية مع الطبيبة</small>
            <b>السعر يظهر في الدفع</b>
          </button>
        </div>
      </section>

      <section class="booking__section">
        <h2 class="section-title">من سيزور الطبيبة؟</h2>
        <div class="children-row">
          <button
            v-for="(child, index) in children"
            :key="child.id"
            type="button"
            class="card child-card"
            :class="{ 'child-card--selected': childId === child.id }"
            :aria-pressed="childId === child.id"
            @click="childId = child.id"
          >
            <span
              class="child-card__avatar"
              :class="
                index % 2 === 0
                  ? 'child-card__avatar--rose'
                  : 'child-card__avatar--sky'
              "
              >{{ child.fullName.trim().charAt(0) }}</span
            >
            <strong>{{ child.fullName }}</strong>
            <small>{{ childAge(child) }}</small>
          </button>
          <button
            type="button"
            class="child-add"
            aria-label="إضافة طفل"
            @click="router.push({ name: 'add-child' })"
          >
            <ion-icon :icon="addOutline" />
            <span>طفل</span>
          </button>
        </div>
      </section>

      <section class="booking__section">
        <h2 class="section-title">اختر اليوم</h2>
        <div v-if="days.length === 0" class="card empty">
          لا توجد مواعيد متاحة في الأيام القادمة.
        </div>
        <div v-else class="day-row">
          <button
            v-for="day in days"
            :key="day.date"
            type="button"
            class="day-card"
            :class="{ 'day-card--selected': selectedDate === day.date }"
            :aria-label="dayLabel(`${day.date}T12:00:00Z`, timezone)"
            :aria-pressed="selectedDate === day.date"
            @click="pickDay(day.date)"
          >
            <small>{{ weekday(day.date) }}</small>
            <strong>{{ arabicDigits(Number(day.date.slice(-2))) }}</strong>
          </button>
        </div>
      </section>

      <section v-if="selectedDate" class="booking__section">
        <h2 class="section-title">اختر فترة الحضور</h2>
        <div class="window-row">
          <button
            v-for="window in windowsForDay"
            :key="window.windowStart"
            type="button"
            class="window-card"
            :data-session-id="window.sessionId"
            :data-window-start="window.windowStart"
            :class="{
              'window-card--selected':
                selectedWindow?.windowStart === window.windowStart,
            }"
            :aria-pressed="selectedWindow?.windowStart === window.windowStart"
            @click="selectedWindow = window"
          >
            <strong>{{
              windowLabel(window.windowStart, window.windowEnd, timezone)
            }}</strong>
            <span>{{ remainingLabel(window.remaining, window.capacity) }}</span>
          </button>
        </div>
        <p class="window-note">
          تحضرين في أي وقت داخل الفترة — والدور حسب وقت الوصول
        </p>
      </section>

      <section class="booking__section">
        <h2 class="section-title">سبب الزيارة</h2>
        <div class="reason-row">
          <button
            v-for="reason in REASONS"
            :key="reason.value"
            type="button"
            class="reason-chip"
            :class="{ 'reason-chip--selected': visitType === reason.value }"
            :aria-pressed="visitType === reason.value"
            @click="visitType = reason.value"
          >
            {{ reason.label }}
          </button>
        </div>
      </section>

      <div class="booking__sticky">
        <button
          type="button"
          class="continue-button"
          :disabled="!canConfirm"
          @click="confirm"
        >
          <ion-spinner v-if="submitting" name="crescent" />
          <template v-else-if="selectedWindow">
            <ion-icon :icon="walletOutline" />
            المتابعة للدفع ·
            {{
              windowLabel(
                selectedWindow.windowStart,
                selectedWindow.windowEnd,
                timezone,
              )
            }}
          </template>
          <span v-else>اختاري فترة الحضور للمتابعة</span>
        </button>
      </div>
    </div>
  </screen-shell>
</template>

<style scoped>
.centre {
  min-height: 180px;
  display: grid;
  place-items: center;
}
.booking {
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding-block-end: calc(92px + env(safe-area-inset-bottom));
}
.booking__section {
  display: grid;
  gap: 12px;
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.mode {
  min-width: 0;
  padding: 14px;
  border: 2.5px solid transparent;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  color: var(--ink);
  font: inherit;
  text-align: start;
  cursor: pointer;
  box-shadow: var(--sh-sm);
}
.mode--selected {
  border-color: var(--coral);
}
.mode__top {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-block-end: 6px;
}
.mode__icon {
  width: 44px;
  height: 44px;
  border-radius: 15px;
  display: grid;
  place-items: center;
  font-size: 23px;
}
.mode__icon--coral {
  color: var(--coral-ink);
  background: var(--coral-soft);
}
.mode__icon--lav {
  color: #6c4dbb;
  background: var(--lav-soft);
}
.mode__check {
  width: 22px;
  height: 22px;
  border: 2px solid var(--line);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: white;
}
.mode--selected .mode__check {
  border-color: var(--coral);
  background: var(--coral);
}
.mode strong,
.child-card strong {
  font-family: var(--ff-display);
  font-size: 15px;
}
.mode small,
.child-card small {
  color: var(--ink-2);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.45;
}
.mode b {
  color: var(--coral-ink);
  font-size: 12px;
  margin-block-start: 4px;
}
.children-row,
.day-row,
.window-row {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 3px 2px 7px;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}
.children-row::-webkit-scrollbar,
.day-row::-webkit-scrollbar,
.window-row::-webkit-scrollbar {
  display: none;
}
.child-card {
  flex: 0 0 106px;
  padding: 13px 10px;
  border: 2.5px solid transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
  box-shadow: var(--sh-sm);
  scroll-snap-align: start;
}
.child-card--selected {
  border-color: var(--coral);
}
.child-card__avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: white;
  font-family: var(--ff-display);
  font-size: 20px;
  font-weight: 800;
}
.child-card__avatar--rose {
  background: var(--rose);
}
.child-card__avatar--sky {
  background: var(--sky);
}
.child-add {
  flex: 0 0 78px;
  border: 2px dashed var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-2);
  color: var(--coral-ink);
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 2px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.child-add ion-icon {
  font-size: 25px;
}
.day-card {
  flex: 0 0 66px;
  padding: 11px 0;
  border: none;
  border-radius: 18px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--sh-sm);
  display: grid;
  justify-items: center;
  gap: 2px;
  font: inherit;
  cursor: pointer;
  scroll-snap-align: start;
}
.day-card--selected {
  background: var(--coral);
  color: white;
  box-shadow: 0 8px 18px rgb(255 126 95 / 40%);
}
.day-card small {
  font-size: 12px;
  font-weight: 700;
  opacity: 0.75;
}
.day-card strong {
  font: 800 22px/1.1 var(--ff-display);
}
.window-card {
  flex: 0 0 142px;
  padding: 12px 13px;
  border: none;
  border-radius: 18px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--sh-sm);
  display: grid;
  justify-items: center;
  gap: 7px;
  font: inherit;
  text-align: center;
  cursor: pointer;
  scroll-snap-align: start;
}
.window-card--selected {
  background: var(--coral);
  color: white;
  box-shadow: 0 8px 18px rgb(255 126 95 / 40%);
}
.window-card strong {
  font: 800 14px/1.35 var(--ff-display);
}
.window-card span {
  padding: 4px 10px;
  border-radius: var(--r-pill);
  background: var(--teal-soft);
  color: var(--teal-ink);
  font-size: 11px;
  font-weight: 800;
}
.window-card--selected span {
  background: rgb(255 255 255 / 22%);
  color: white;
}
.window-note {
  margin: 0;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
.reason-row {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
.reason-chip {
  padding: 8px 14px;
  border: 1.5px solid var(--line);
  border-radius: var(--r-pill);
  background: var(--surface);
  color: var(--ink-2);
  font: 700 13.5px var(--ff-body);
  cursor: pointer;
}
.reason-chip--selected {
  background: var(--coral);
  border-color: var(--coral);
  color: white;
}
.empty {
  padding: 20px;
  text-align: center;
  color: var(--ink-2);
  font-weight: 600;
}
.booking__sticky {
  position: fixed;
  z-index: 20;
  inset-inline: 0;
  bottom: 0;
  padding: 28px max(16px, env(safe-area-inset-left))
    calc(14px + env(safe-area-inset-bottom));
  background: linear-gradient(transparent, var(--bg) 30%);
  pointer-events: none;
}
.continue-button {
  width: min(488px, 100%);
  min-height: 56px;
  margin-inline: auto;
  padding: 14px 20px;
  border: none;
  border-radius: var(--r-pill);
  background: var(--coral);
  color: white;
  box-shadow: 0 8px 20px rgb(255 126 95 / 40%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font: 800 15px var(--ff-body);
  pointer-events: auto;
  cursor: pointer;
}
.continue-button:disabled {
  opacity: 0.5;
  box-shadow: none;
}

@media (max-width: 350px) {
  .mode-grid {
    gap: 8px;
  }
  .mode {
    padding: 11px;
  }
  .mode small {
    min-height: 34px;
  }
}
</style>

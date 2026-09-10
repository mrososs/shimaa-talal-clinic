<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton, IonIcon, IonSpinner } from '@ionic/vue';
import { checkmarkCircle } from 'ionicons/icons';
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
import { bookingApi, session } from '../../../runtime';

/**
 * Book a visit: child, day, arrival window, reason, confirm.
 *
 * One screen with four steps rather than four routes. The whole thing is a
 * single decision — "when are we coming in" — and a wizard that pushes a route
 * per answer makes going back one step feel like leaving.
 *
 * There is no payment step. The design puts one after confirm; payments are out
 * of scope for this phase, and a booking is complete without one.
 *
 * What a parent picks is a *window*, never a minute. The queue orders by actual
 * arrival, so "10:12" would be a promise the clinic does not keep — the window
 * and its remaining count are the honest version.
 */

const REASONS = [
  { value: VisitType.NewVisit, label: 'كشف جديد' },
  { value: VisitType.FollowUp, label: 'متابعة' },
  { value: VisitType.Vaccination, label: 'تطعيم' },
  { value: VisitType.Consultation, label: 'استشارة' },
  { value: VisitType.Newborn, label: 'حديث الولادة' },
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

// Readonly because the session store hands out a frozen view of its state:
// a screen may read the family, never edit it in place.
const children = computed<readonly GuardianChild[]>(
  () => state.identity?.children ?? [],
);
const timezone = computed(() => state.identity?.clinic.timezone);

const windowsForDay = computed(
  () =>
    days.value.find((day) => day.date === selectedDate.value)?.windows ?? [],
);

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

function pickDay(date: string): void {
  selectedDate.value = date;
  // The window belonged to the old day; keeping it would confirm a booking the
  // person is no longer looking at.
  selectedWindow.value = null;
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
      name: 'appointment-detail',
      params: { appointmentId: appointment.id },
    });
  } catch (error) {
    failure.value = apiMessage(error);
    // The window may have filled while this screen was open. Re-reading is the
    // only honest response: the count that was on screen is now wrong.
    selectedWindow.value = null;
    await load();
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <screen-shell
    title="حجز موعد"
    subtitle="اختاري الطفل واليوم وفترة الحضور"
    :back-to="{ name: 'home' }"
  >
    <div v-if="loading" class="card card--centre">
      <ion-spinner name="crescent" />
    </div>

    <div v-else class="stack">
      <form-notice :message="failure" />

      <!-- Child -->
      <section class="stack stack--tight">
        <h2 class="section-title">لِمن الموعد؟</h2>
        <div class="chips">
          <button
            v-for="child in children"
            :key="child.id"
            type="button"
            class="chip"
            :class="{ 'chip--on': childId === child.id }"
            @click="childId = child.id"
          >
            {{ child.fullName }}
          </button>
        </div>
      </section>

      <!-- Day -->
      <section class="stack stack--tight">
        <h2 class="section-title">اليوم</h2>
        <div v-if="days.length === 0" class="card empty">
          <p class="subtitle">
            لا توجد مواعيد متاحة في الأيام القادمة. جرّبي لاحقاً أو تواصلي مع
            الاستقبال.
          </p>
        </div>
        <div v-else class="days">
          <button
            v-for="day in days"
            :key="day.date"
            type="button"
            class="chip day"
            :class="{ 'chip--on': selectedDate === day.date }"
            @click="pickDay(day.date)"
          >
            {{ dayLabel(`${day.date}T12:00:00Z`, timezone) }}
          </button>
        </div>
      </section>

      <!-- Arrival window -->
      <section v-if="selectedDate" class="stack stack--tight">
        <h2 class="section-title">فترة الحضور</h2>
        <p class="subtitle windows__note">
          تحضرين في أي وقت داخل الفترة، والدور حسب وقت الوصول.
        </p>

        <div class="windows">
          <button
            v-for="window in windowsForDay"
            :key="window.windowStart"
            type="button"
            class="card window"
            :data-session-id="window.sessionId"
            :data-window-start="window.windowStart"
            :class="{
              'window--on': selectedWindow?.windowStart === window.windowStart,
            }"
            @click="selectedWindow = window"
          >
            <span class="window__time">
              {{ windowLabel(window.windowStart, window.windowEnd, timezone) }}
            </span>
            <span class="window__left">
              {{ remainingLabel(window.remaining, window.capacity) }}
            </span>
            <ion-icon
              v-if="selectedWindow?.windowStart === window.windowStart"
              class="window__tick"
              :icon="checkmarkCircle"
            />
          </button>
        </div>
      </section>

      <!-- Reason -->
      <section class="stack stack--tight">
        <h2 class="section-title">سبب الزيارة</h2>
        <div class="chips">
          <button
            v-for="reason in REASONS"
            :key="reason.value"
            type="button"
            class="chip"
            :class="{ 'chip--on': visitType === reason.value }"
            @click="visitType = reason.value"
          >
            {{ reason.label }}
          </button>
        </div>
      </section>

      <div class="actions">
        <ion-button
          expand="block"
          size="large"
          :disabled="!canConfirm"
          @click="confirm"
        >
          <ion-spinner v-if="submitting" name="crescent" />
          <span v-else>تأكيد الحجز</span>
        </ion-button>
      </div>
    </div>
  </screen-shell>
</template>

<style scoped>
.card--centre {
  display: grid;
  place-items: center;
  min-height: 140px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  cursor: pointer;
  font-family: var(--ff-body);
}

.days {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-block-end: 4px;
  scrollbar-width: none;
}

.days::-webkit-scrollbar {
  display: none;
}

.day {
  white-space: nowrap;
  flex-shrink: 0;
}

.windows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.windows__note {
  font-size: 13px;
}

.window {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1.5px solid transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: start;
}

.window--on {
  border-color: var(--coral);
  background: var(--coral-soft);
}

.window__time {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 16px;
  flex: 1;
}

.window__left {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-2);
}

.window--on .window__left {
  color: var(--coral-ink);
}

.window__tick {
  font-size: 20px;
  color: var(--coral);
}

.empty {
  text-align: center;
  padding-block: 20px;
}
</style>

<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue';
import {
  calendarOutline,
  chatbubblesOutline,
  chevronBackOutline,
  logOutOutline,
  statsChartOutline,
  timeOutline,
  walletOutline,
} from 'ionicons/icons';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { shortDayLabel, windowLabel } from '../../../shared/format';
import { arabicDigits } from '../../../shared/numerals';
import { session } from '../../../runtime';
import { useAppointments } from '../../appointments/composables/useAppointments';

/**
 * Home, as the design lays it out: who you are, what is next, what you can do.
 *
 * Only working destinations are shown. Payments, messaging and growth are
 * backed by guardian-scoped APIs and are safe to offer here.
 *
 * The live queue has its own top-level tab, so Home stays focused on the next
 * visit, family shortcuts and tasks that start a separate flow.
 */

const router = useRouter();
const state = session.state;
const appointments = useAppointments();
const upcoming = computed(() => appointments.items.value);
const failure = appointments.failure;
const loading = appointments.loading;
const signingOut = shallowRef(false);

const guardian = computed(() => state.identity?.guardian ?? null);
const children = computed(() => state.identity?.children ?? []);
const clinic = computed(() => state.identity?.clinic ?? null);

/** The one the design puts on the card: the soonest that has not happened. */
const nextVisit = computed(() => upcoming.value?.[0] ?? null);

const childNameById = computed(
  () => new Map(children.value.map((child) => [child.id, child.fullName])),
);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير 🌤️';
  if (hour < 18) return 'مساء الخير ☀️';
  return 'مساء الخير 🌙';
});

const STATUS_LABEL: Record<string, string> = {
  requested: 'قيد المراجعة',
  confirmed: 'مؤكّد',
  checked_in: 'في العيادة',
};

async function refresh(event?: RefresherCustomEvent): Promise<void> {
  await Promise.all([session.refreshIdentity(), appointments.refresh()]);
  await event?.target.complete();
}

async function signOut(): Promise<void> {
  signingOut.value = true;
  try {
    await session.signOut();
    await router.replace({ name: 'sign-in' });
  } finally {
    signingOut.value = false;
  }
}

onIonViewWillEnter(() => void appointments.open());
onIonViewDidLeave(() => appointments.close());
</script>

<template>
  <screen-shell>
    <template #above>
      <ion-refresher
        slot="fixed"
        @ion-refresh="refresh($event)"
      >
        <ion-refresher-content />
      </ion-refresher>

      <header class="greet">
        <div class="greet__avatar">
          {{ (guardian?.fullName ?? 'ض').trim().charAt(0) }}
        </div>
        <div class="greet__text">
          <p class="greet__hello">
            {{ greeting }}
          </p>
          <p class="greet__name">
            {{ guardian?.fullName ?? 'أهلاً بك' }}
          </p>
        </div>
        <button
          type="button"
          class="greet__out"
          aria-label="تسجيل الخروج"
          :disabled="signingOut"
          @click="signOut"
        >
          <ion-icon :icon="logOutOutline" />
        </button>
      </header>
    </template>

    <div class="stack">
      <!-- The clinic, and whether it is open to bookings right now. -->
      <section class="card doctor">
        <div class="doctor__avatar">
          ش
        </div>
        <div class="doctor__text">
          <p class="doctor__name">
            {{ clinic?.name ?? 'عيادة د. شيماء طلال' }}
          </p>
          <p class="doctor__role">
            استشارية طب الأطفال وحديثي الولادة
          </p>
        </div>
      </section>

      <form-notice :message="failure" />

      <!-- Next visit -->
      <section class="stack stack--tight">
        <div class="row">
          <h2 class="section-title">
            موعدك القادم
          </h2>
          <button
            v-if="nextVisit"
            type="button"
            class="link"
            @click="router.push({ name: 'appointments' })"
          >
            الكل
          </button>
        </div>

        <div
          v-if="loading"
          class="card card--centre"
        >
          <ion-spinner name="crescent" />
        </div>

        <button
          v-else-if="nextVisit"
          type="button"
          class="card visit"
          @click="
            router.push({
              name: 'appointment-detail',
              params: { appointmentId: nextVisit.id },
            })
          "
        >
          <div class="visit__date">
            <span class="visit__day">{{
              arabicDigits(
                new Date(nextVisit.windowStart).toLocaleDateString('en-CA', {
                  timeZone: clinic?.timezone ?? 'Africa/Cairo',
                  day: 'numeric',
                }),
              )
            }}</span>
            <span class="visit__month">{{
              shortDayLabel(nextVisit.windowStart, clinic?.timezone).split(
                ' ',
              )[1]
            }}</span>
          </div>
          <div class="visit__text">
            <p class="visit__child">
              {{ childNameById.get(nextVisit.childId) ?? 'موعد' }}
            </p>
            <p class="visit__window">
              {{
                windowLabel(
                  nextVisit.windowStart,
                  nextVisit.windowEnd,
                  clinic?.timezone,
                )
              }}
            </p>
          </div>
          <span
            class="chip"
            :class="{ 'chip--on': nextVisit.status === 'confirmed' }"
          >
            {{ STATUS_LABEL[nextVisit.status] ?? nextVisit.status }}
          </span>
        </button>

        <div
          v-else
          class="card empty"
        >
          <p class="subtitle">
            لا توجد مواعيد قادمة. احجزي موعداً لأحد أطفالك.
          </p>
        </div>
      </section>

      <!-- What you can do -->
      <section class="stack stack--tight">
        <h2 class="section-title">
          ماذا تريدين أن تفعلي؟
        </h2>
        <div class="actions-grid">
          <button
            type="button"
            class="card action"
            @click="router.push({ name: 'booking' })"
          >
            <span class="action__ico action__ico--coral">
              <ion-icon :icon="calendarOutline" />
            </span>
            <span class="action__title">حجز موعد</span>
            <span class="action__hint">كشف أو استشارة</span>
          </button>

          <button
            type="button"
            class="card action"
            @click="router.push({ name: 'appointments' })"
          >
            <span class="action__ico action__ico--teal">
              <ion-icon :icon="timeOutline" />
            </span>
            <span class="action__title">مواعيدي</span>
            <span class="action__hint">تأجيل أو إلغاء</span>
          </button>

          <button
            type="button"
            class="card action"
            @click="router.push({ name: 'growth' })"
          >
            <span class="action__ico action__ico--lav">
              <ion-icon :icon="statsChartOutline" />
            </span>
            <span class="action__title">متابعة النمو</span>
            <span class="action__hint">الوزن والطول</span>
          </button>

          <button
            type="button"
            class="card action"
            @click="router.push({ name: 'messages' })"
          >
            <span class="action__ico action__ico--blue">
              <ion-icon :icon="chatbubblesOutline" />
            </span>
            <span class="action__title">رسائل العيادة</span>
            <span class="action__hint">سؤال أو متابعة</span>
          </button>

          <button
            type="button"
            class="card action"
            @click="router.push({ name: 'payments' })"
          >
            <span class="action__ico action__ico--sun">
              <ion-icon :icon="walletOutline" />
            </span>
            <span class="action__title">الدفع</span>
            <span class="action__hint">نقداً أو InstaPay</span>
          </button>
        </div>
      </section>

      <!-- The family -->
      <section
        v-if="children.length > 0"
        class="stack stack--tight"
      >
        <h2 class="section-title">
          أطفالك
        </h2>
        <article
          v-for="child in children"
          :key="child.id"
          class="card child"
        >
          <div class="child__avatar">
            {{ child.fullName.trim().charAt(0) }}
          </div>
          <p class="child__name">
            {{ child.fullName }}
          </p>
          <ion-icon
            class="child__chevron"
            :icon="chevronBackOutline"
          />
        </article>
      </section>
    </div>
  </screen-shell>
</template>

<style scoped>
.greet {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 18px 4px;
  max-width: 520px;
  margin-inline: auto;
}

.greet__avatar {
  width: 46px;
  height: 46px;
  border-radius: var(--r-pill);
  background: var(--coral-soft);
  color: var(--coral-ink);
  display: grid;
  place-items: center;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 19px;
  flex-shrink: 0;
}

.greet__text {
  flex: 1;
  min-width: 0;
}

.greet__hello {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}

.greet__name {
  margin: 0;
  font-family: var(--ff-display);
  font-size: 19px;
  font-weight: 800;
}

.greet__out {
  width: 42px;
  height: 42px;
  border-radius: var(--r-pill);
  border: none;
  background: var(--surface);
  box-shadow: var(--sh-sm);
  color: var(--ink-2);
  display: grid;
  place-items: center;
  font-size: 19px;
  cursor: pointer;
  flex-shrink: 0;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  color: var(--coral);
  cursor: pointer;
}

.card--centre {
  display: grid;
  place-items: center;
  min-height: 88px;
}

.doctor {
  display: flex;
  align-items: center;
  gap: 12px;
}

.doctor__avatar {
  width: 52px;
  height: 52px;
  border-radius: var(--r-md);
  background: var(--teal-soft);
  color: var(--teal-ink);
  display: grid;
  place-items: center;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 21px;
  flex-shrink: 0;
}

.doctor__text {
  min-width: 0;
}

.doctor__name {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 16px;
}

.doctor__role {
  margin: 2px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.visit {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  border: none;
  text-align: start;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.visit__date {
  width: 56px;
  height: 62px;
  border-radius: var(--r-sm);
  background: var(--coral-soft);
  color: var(--coral-ink);
  display: grid;
  place-content: center;
  text-align: center;
  flex-shrink: 0;
}

.visit__day {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 22px;
  line-height: 1;
}

.visit__month {
  font-size: 12px;
  font-weight: 700;
}

.visit__text {
  flex: 1;
  min-width: 0;
}

.visit__child {
  margin: 0;
  font-weight: 800;
}

.visit__window {
  margin: 3px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}

.empty {
  text-align: center;
  padding-block: 22px;
}

.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  border: none;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: start;
}

.action__ico {
  width: 42px;
  height: 42px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  font-size: 21px;
  margin-block-end: 4px;
}

.action__ico--coral {
  background: var(--coral-soft);
  color: var(--coral-ink);
}

.action__ico--teal {
  background: var(--teal-soft);
  color: var(--teal-ink);
}

.action__ico--lav {
  background: var(--lav-soft);
  color: #6b4fb0;
}

.action__ico--blue {
  background: #e8f5fd;
  color: #2176a7;
}

.action__ico--sun {
  background: var(--sun-soft);
  color: #8a6212;
}

.action__title {
  font-weight: 800;
  font-size: 15px;
}

.action__hint {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-2);
}

.child {
  display: flex;
  align-items: center;
  gap: 12px;
}

.child__avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--r-pill);
  background: var(--lav-soft);
  color: #6b4fb0;
  display: grid;
  place-items: center;
  font-family: var(--ff-display);
  font-weight: 800;
  flex-shrink: 0;
}

.child__name {
  margin: 0;
  flex: 1;
  font-weight: 700;
}

.child__chevron {
  color: var(--muted);
  font-size: 18px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  checkmarkCircle,
  informationCircleOutline,
  medkitOutline,
  peopleOutline,
} from 'ionicons/icons';
import {
  ClinicSessionStatus,
  DoctorPresence,
  QueueStatus,
  type ParentQueueItem,
} from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';
import { windowLabel } from '../../../shared/format';
import { isNear } from '../composables/useLiveQueue';
import GraceCountdown from './GraceCountdown.vue';

/**
 * One child's place in today's queue, in whichever state they are actually in.
 *
 * Six states, one card. They are not six screens because they are one thing
 * happening — a family's turn — and a parent refreshing into a different layout
 * every few minutes would have to re-find the number that matters each time.
 *
 * The number that matters is "أمامك N حالات". It is a count the server made
 * from the real service order, so it stays true after an emergency, a reorder
 * or a deferral. The ticket number is shown as identification, never as a
 * position: subtracting it from anything is exactly the mistake this app is
 * built not to make.
 */

const props = defineProps<{
  item: ParentQueueItem;
  graceMinutes?: number;
}>();

const emit = defineEmits<{ graceExpired: [] }>();

const entry = computed(() => props.item.queueEntry);
const ahead = computed(() => entry.value?.aheadCount ?? 0);
const near = computed(() => isNear(props.item));

const called = computed(() => entry.value?.status === QueueStatus.Called);
const inService = computed(() => entry.value?.status === QueueStatus.InService);
const missed = computed(() => entry.value?.status === QueueStatus.Missed);
const done = computed(() => entry.value?.status === QueueStatus.Done);
const cancelled = computed(
  () => entry.value?.status === QueueStatus.Cancelled,
);

/** The turn is happening, so the card leads with that rather than a count. */
const highlight = computed(() => called.value || inService.value);

const stalled = computed(
  () =>
    props.item.session.status !== ClinicSessionStatus.Open ||
    props.item.session.doctorPresence !== DoctorPresence.Arrived,
);

const estimate = computed(() => entry.value?.estimatedWaitMinutes ?? null);
</script>

<template>
  <section
    class="turn card pop"
    :class="{ 'turn--live': highlight }"
  >
    <header class="turn__head">
      <div>
        <p class="turn__child">
          {{ item.childName }}
        </p>
        <p
          v-if="item.appointment"
          class="turn__window"
        >
          {{
            windowLabel(item.appointment.windowStart, item.appointment.windowEnd)
          }}
        </p>
      </div>
      <span
        v-if="entry"
        class="turn__ticket"
      >
        <span class="turn__ticket-label">رقمك</span>
        <span class="turn__ticket-num">
          {{ arabicDigits(entry.ticketNumber) }}
        </span>
      </span>
    </header>

    <!-- Booked, nobody has checked them in. Not a place in the queue. -->
    <div
      v-if="!entry"
      class="turn__body"
    >
      <span class="turn__ico">
        <ion-icon :icon="informationCircleOutline" />
      </span>
      <div>
        <p class="turn__headline">
          لم يتم تسجيل الوصول بعد
        </p>
        <p class="turn__note">
          يبدأ دورك في الطابور بعد أن يسجّل الاستقبال وصولك في العيادة.
        </p>
      </div>
    </div>

    <!-- Their turn. -->
    <div
      v-else-if="called"
      class="turn__body turn__body--hero"
    >
      <span class="turn__hero-ico">
        <ion-icon :icon="checkmarkCircle" />
      </span>
      <h2 class="turn__hero">
        حان دورك الآن!
      </h2>
      <p class="turn__hero-note">
        توجّهي إلى غرفة الكشف — رقمك {{ arabicDigits(entry.ticketNumber) }}
      </p>
      <grace-countdown
        :expires-at="entry.graceExpiresAt"
        :grace-minutes="graceMinutes"
        @expire="emit('graceExpired')"
      />
    </div>

    <div
      v-else-if="inService"
      class="turn__body turn__body--hero"
    >
      <span class="turn__hero-ico">
        <ion-icon :icon="medkitOutline" />
      </span>
      <h2 class="turn__hero">
        الكشف جارٍ الآن
      </h2>
      <p class="turn__hero-note">
        نتمنى لكم زيارة موفّقة.
      </p>
    </div>

    <div
      v-else-if="missed"
      class="turn__body"
    >
      <span class="turn__ico turn__ico--warn">
        <ion-icon :icon="informationCircleOutline" />
      </span>
      <div>
        <p class="turn__headline">
          تم تخطّي دورك
        </p>
        <p class="turn__note">
          راجعي الاستقبال وسيعيدونك إلى الطابور برقم جديد.
        </p>
      </div>
    </div>

    <div
      v-else-if="done"
      class="turn__body"
    >
      <span class="turn__ico turn__ico--ok">
        <ion-icon :icon="checkmarkCircle" />
      </span>
      <div>
        <p class="turn__headline">
          انتهت زيارتك اليوم
        </p>
        <p class="turn__note">
          نتمنى لطفلك دوام الصحة.
        </p>
      </div>
    </div>

    <div
      v-else-if="cancelled"
      class="turn__body"
    >
      <span class="turn__ico turn__ico--warn">
        <ion-icon :icon="informationCircleOutline" />
      </span>
      <div>
        <p class="turn__headline">
          تمت إزالتك من طابور اليوم
        </p>
        <p class="turn__note">
          راجعي الاستقبال لمعرفة التفاصيل.
        </p>
      </div>
    </div>

    <!-- Waiting: the count is the headline, and it is a fact. -->
    <div
      v-else
      class="turn__body"
    >
      <span
        class="turn__ico"
        :class="{ 'turn__ico--soon': near }"
      >
        <ion-icon :icon="peopleOutline" />
      </span>
      <div>
        <p
          class="turn__headline"
          :class="{ 'turn__headline--soon': near }"
        >
          <template v-if="ahead === 0">
            أنت التالي
          </template>
          <template v-else>
            أمامك {{ arabicDigits(ahead) }}
            {{ ahead === 1 ? 'حالة' : 'حالات' }}
          </template>
        </p>

        <p
          v-if="near"
          class="turn__note turn__note--soon"
        >
          اقترب دورك — يُفضّل أن تكوني في العيادة الآن.
        </p>
        <p
          v-else-if="stalled"
          class="turn__note"
        >
          مكانك محفوظ. سنُحدّث العدد فور أن يتحرّك الطابور.
        </p>
        <p
          v-else-if="estimate"
          class="turn__note"
        >
          الوقت المتوقّع تقريباً
          {{ arabicDigits(estimate.from) }}–{{ arabicDigits(estimate.to) }}
          دقيقة
        </p>
        <p
          v-else
          class="turn__note"
        >
          سنُحدّث العدد تلقائياً كلما تحرّك الطابور.
        </p>
      </div>
    </div>

    <p
      v-if="entry?.isEmergency"
      class="turn__flag"
    >
      تم تصنيف حالتك كحالة عاجلة من قِبل العيادة.
    </p>
  </section>
</template>

<style scoped>
.turn {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.turn--live {
  background: linear-gradient(135deg, #21bfa6, #0e9d8a 120%);
  color: #fff;
}

.turn__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.turn__child {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 18px;
}

.turn__window {
  margin: 3px 0 0;
  font-size: 13px;
  opacity: 0.75;
}

.turn__ticket {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 14px;
  border-radius: var(--r-lg);
  background: var(--surface-2);
}

.turn--live .turn__ticket {
  background: rgb(255 255 255 / 22%);
}

.turn__ticket-label {
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
}

.turn__ticket-num {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 22px;
  line-height: 1.1;
}

.turn__body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.turn__body--hero {
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding-block: 6px;
}

.turn__ico {
  display: grid;
  place-items: center;
  inline-size: 42px;
  block-size: 42px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 22px;
  flex-shrink: 0;
}

.turn__ico--soon {
  background: var(--coral-soft);
  color: var(--coral-ink);
}

.turn__ico--ok {
  background: var(--teal-soft);
  color: var(--teal-ink);
}

.turn__ico--warn {
  background: var(--sun-soft);
  color: var(--sun-ink);
}

.turn__hero-ico {
  display: grid;
  place-items: center;
  inline-size: 62px;
  block-size: 62px;
  border-radius: var(--r-pill);
  background: rgb(255 255 255 / 22%);
  font-size: 34px;
}

.turn__headline {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 22px;
  line-height: 1.35;
}

.turn__headline--soon {
  color: var(--coral-ink);
}

.turn__hero {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 25px;
}

.turn__hero-note {
  margin: 0;
  font-size: 14.5px;
  opacity: 0.92;
}

.turn__note {
  margin: 5px 0 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--ink-2);
}

.turn__note--soon {
  color: var(--coral-ink);
  font-weight: 600;
}

.turn__flag {
  margin: 0;
  padding-block-start: 10px;
  border-block-start: 1px solid var(--line);
  font-size: 12.5px;
  color: var(--ink-2);
}

.turn--live .turn__note,
.turn--live .turn__flag {
  color: rgb(255 255 255 / 88%);
  border-color: rgb(255 255 255 / 25%);
}
</style>

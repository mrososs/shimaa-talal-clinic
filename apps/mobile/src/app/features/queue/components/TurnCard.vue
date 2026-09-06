<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  checkmarkCircle,
  chevronBackOutline,
  informationCircleOutline,
  medkitOutline,
  refreshOutline,
  timeOutline,
} from 'ionicons/icons';
import {
  AppointmentStatus,
  ClinicSessionStatus,
  DoctorPresence,
  QueueStatus,
  type ParentQueueItem,
} from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';
import { windowLabel } from '../../../shared/format';
import { canDefer, defersLeft, isNear } from '../composables/useLiveQueue';
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

const props = withDefaults(
  defineProps<{
    item: ParentQueueItem;
    graceMinutes?: number;
    /** The clinic's own limit on how often a parent may skip their turn. */
    maxSelfDefers?: number;
    deferring?: boolean;
  }>(),
  { graceMinutes: undefined, maxSelfDefers: 0, deferring: false },
);

const emit = defineEmits<{ graceExpired: []; defer: [entryId: string] }>();

const entry = computed(() => props.item.queueEntry);
const ahead = computed(() => entry.value?.aheadCount ?? 0);
const near = computed(() => isNear(props.item));

const waiting = computed(() => entry.value?.status === QueueStatus.Waiting);
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

/**
 * A booking the clinic has not accepted yet.
 *
 * Its window is shown, because the family asked for it — but unlabelled it
 * reads as a confirmed time, and the whole point of the `requested` state is
 * that it is not one.
 */
const pending = computed(
  () => props.item.appointment?.status === AppointmentStatus.Requested,
);

/**
 * "Skip my turn" is offered only while it is genuinely theirs to give.
 *
 * Once called, the turn is happening. Once the clinic's limit is used up, the
 * server would refuse — and a button that is going to be refused should not
 * have been drawn.
 */
const deferrable = computed(() => canDefer(props.item, props.maxSelfDefers));
const remaining = computed(() => defersLeft(props.item, props.maxSelfDefers));

/**
 * Arabic counts one, two and many differently.
 *
 * "متاح ٢ مرات" is what a naive plural produces and not what anyone says; the
 * dual has its own word. The clinic's limit is small, so the three cases that
 * matter are spelled out rather than routed through an i18n library the app
 * does not have.
 */
const remainingLabel = computed(() => {
  const left = remaining.value;
  if (left === 1) return 'متاح مرة واحدة';
  if (left === 2) return 'متاح مرتين';
  return `متاح ${arabicDigits(left)} مرات`;
});
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
          <span
            v-if="pending"
            class="turn__pending"
          >قيد المراجعة</span>
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

    <!-- Waiting. The counter is the screen, exactly as the prototype has it —
         one number, large enough to read at arm's length. The prototype's is
         the ticket being served now; this one is how many are ahead, which is
         the same fact told from the only side a parent is entitled to see. -->
    <div
      v-else
      class="counter"
      :class="{ 'counter--soon': near }"
    >
      <span class="counter__label">
        {{ ahead === 0 ? 'دورك الآن التالي' : 'أمامك في الطابور' }}
      </span>

      <span
        v-if="ahead > 0"
        class="counter__num"
      >{{ arabicDigits(ahead) }}</span>
      <span
        v-else
        class="counter__next"
      >أنت التالي</span>

      <span
        v-if="ahead > 0"
        class="counter__unit"
      >{{ ahead === 1 ? 'حالة' : 'حالات' }}</span>

      <p class="counter__meta">
        أنت رقم {{ arabicDigits(entry.ticketNumber) }} · متابعة مباشرة
      </p>

      <p
        v-if="near"
        class="counter__note counter__note--soon"
      >
        اقترب دورك — يُفضّل أن تكوني في العيادة الآن.
      </p>
      <p
        v-else-if="stalled"
        class="counter__note"
      >
        مكانك محفوظ. سنُحدّث العدد فور أن يتحرّك الطابور.
      </p>
      <p
        v-else
        class="counter__note"
      >
        يتحدّث تلقائياً كلما تحرّك الطابور.
      </p>
    </div>

    <!-- Where the prototype put its ticking countdown. A range instead: the
         clinic cannot promise a minute, and a parent driving in reads a
         ticking clock as one. -->
    <div
      v-if="waiting && estimate"
      class="eta"
    >
      <span class="eta__ico">
        <ion-icon :icon="timeOutline" />
      </span>
      <div>
        <p class="eta__label">
          الوقت المتوقّع تقريباً
        </p>
        <p class="eta__value">
          {{ arabicDigits(estimate.from) }}–{{ arabicDigits(estimate.to) }}
          <span class="eta__unit">دقيقة</span>
        </p>
        <p class="eta__note">
          تقدير تقريبي يتغيّر مع حركة الطابور
        </p>
      </div>
    </div>

    <p
      v-if="entry?.isEmergency"
      class="turn__flag"
    >
      تم تصنيف حالتك كحالة عاجلة من قِبل العيادة.
    </p>

    <!-- The design's own card: an offer, not a warning. -->
    <button
      v-if="deferrable && entry"
      class="defer"
      type="button"
      :disabled="deferring"
      @click="emit('defer', entry.id)"
    >
      <span class="defer__ico">
        <ion-icon :icon="refreshOutline" />
      </span>
      <span class="defer__text">
        <span class="defer__title">عالق في الزحام؟ تخطَّ دورك مرة</span>
        <span class="defer__note">
          أجّل دورك مريضاً واحداً دون فقدان حجزك · {{ remainingLabel }}
        </span>
      </span>
      <span class="defer__chev">
        <ion-icon :icon="chevronBackOutline" />
      </span>
    </button>
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

.turn__pending {
  display: inline-block;
  margin-inline-start: 6px;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--sun-soft);
  color: var(--sun-ink);
  font-size: 11.5px;
  font-weight: 700;
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

.counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding-block: 10px 4px;
}

.counter__label {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink-2);
}

/* 62px, as the prototype has it: the one number on the screen that a parent
   should be able to read without looking properly. */
.counter__num {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 62px;
  line-height: 1.05;
  color: var(--ink);
}

.counter--soon .counter__num,
.counter--soon .counter__next {
  color: var(--coral-ink);
}

.counter__next {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 34px;
  line-height: 1.2;
  padding-block: 8px;
  color: var(--ink);
}

.counter__unit {
  font-family: var(--ff-display);
  font-weight: 700;
  font-size: 17px;
  color: var(--ink-2);
}

.counter__meta {
  margin: 10px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}

.counter__note {
  margin: 8px 0 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--ink-2);
  text-align: center;
}

.counter__note--soon {
  color: var(--coral-ink);
  font-weight: 600;
}

.eta {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--r-lg);
  background: var(--surface-2);
}

.eta__ico {
  display: grid;
  place-items: center;
  inline-size: 42px;
  block-size: 42px;
  border-radius: var(--r-pill);
  background: var(--teal-soft);
  color: var(--teal-ink);
  font-size: 22px;
  flex-shrink: 0;
}

.eta__label {
  margin: 0;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-2);
}

.eta__value {
  margin: 2px 0 0;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 22px;
  color: var(--ink);
}

.eta__unit {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-2);
}

.eta__note {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.defer {
  display: flex;
  align-items: center;
  gap: 12px;
  inline-size: 100%;
  padding: 12px 14px;
  border-radius: var(--r-lg);
  border: 1.5px solid var(--line);
  background: var(--surface-2);
  color: var(--ink);
  text-align: start;
  font-family: var(--ff-body);
}

.defer:disabled {
  opacity: 0.55;
}

.defer__ico {
  display: grid;
  place-items: center;
  inline-size: 38px;
  block-size: 38px;
  border-radius: var(--r-pill);
  background: var(--coral-soft);
  color: var(--coral-ink);
  font-size: 20px;
  flex-shrink: 0;
}

.defer__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-inline-size: 0;
}

.defer__title {
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 14.5px;
}

.defer__note {
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.55;
}

.defer__chev {
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 18px;
  flex-shrink: 0;
}

.turn--live .turn__note,
.turn--live .turn__flag {
  color: rgb(255 255 255 / 88%);
  border-color: rgb(255 255 255 / 25%);
}
</style>

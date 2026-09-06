<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  IonButton,
  IonIcon,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
} from '@ionic/vue';
import { calendarOutline, refreshOutline } from 'ionicons/icons';
import { ClinicDialog } from '@clinic/client-ui';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import { arabicDigits } from '../../../shared/numerals';
import { session } from '../../../runtime';
import { useLiveQueue } from '../composables/useLiveQueue';
import SessionBanner from '../components/SessionBanner.vue';
import TurnCard from '../components/TurnCard.vue';

/**
 * The live queue, for one family.
 *
 * It composes and reports; it decides nothing. The count of patients ahead, the
 * order, whose turn it is and whether the clinic is running all come from the
 * server — this screen renders what it was told and asks again every fifteen
 * seconds.
 *
 * Polling starts when the Ionic page is entered and stops when it leaves, so a
 * parent who taps to Home is not still asking. Nothing is cached across a visit
 * beyond the last answer, and the first thing every visit does is ask again.
 *
 * Skipping a turn is the one thing a parent may change, and the clinic decides
 * how often. There is no "notify me" and no "I am on my way": each needs a
 * product decision nobody has made, and a control that does nothing is worse
 * than one that is absent.
 */

const queue = useLiveQueue();

const clinic = computed(() => session.state.identity?.clinic ?? null);
const graceMinutes = computed(() => clinic.value?.gracePeriodMinutes);
const maxSelfDefers = computed(() => clinic.value?.maxSelfDefers ?? 0);

/**
 * Skipping a turn is asked about first.
 *
 * It is reversible in the sense that the queue keeps moving, but it costs one
 * of a small number of deferrals and hands the place to somebody else. The
 * confirmation says both, so nobody spends one by mistake on a scroll.
 */
const deferringEntry = ref<string | null>(null);

function confirmDefer(): void {
  const entryId = deferringEntry.value;
  deferringEntry.value = null;
  if (entryId !== null) void queue.defer(entryId);
}

/** Nothing at all today: no booking, no turn. */
const idle = computed(
  () => !queue.loading.value && queue.items.value.length === 0,
);

// Ionic keeps a page alive between visits, so entering and leaving are the
// lifecycle that matters — `onMounted` would start a loop that never stops.
onIonViewWillEnter(() => void queue.open());
onIonViewDidLeave(() => queue.close());
</script>

<template>
  <screen-shell
    title="العداد المباشر"
    subtitle="دورك في العيادة، محدَّثاً أولاً بأول"
    tabs
  >
    <template #header-end>
      <button
        class="refresh"
        type="button"
        aria-label="تحديث"
        :disabled="queue.refreshing.value"
        @click="queue.refresh()"
      >
        <ion-icon :icon="refreshOutline" />
      </button>
    </template>

    <div class="stack">
      <!-- First load only. A poll must never blank a screen a parent is
           reading. -->
      <div
        v-if="queue.loading.value"
        class="card centre"
      >
        <ion-spinner name="crescent" />
        <p class="muted">
          جارٍ تحديث الطابور…
        </p>
      </div>

      <template v-else>
        <div
          v-if="queue.failure.value"
          class="card notice"
          role="alert"
        >
          <p class="notice__text">
            {{ queue.failure.value }}
          </p>
          <button
            class="notice__retry"
            type="button"
            :disabled="queue.refreshing.value"
            @click="queue.refresh()"
          >
            إعادة المحاولة
          </button>
        </div>

        <!-- Nothing today: no booking and no turn. -->
        <section
          v-if="idle"
          class="card centre empty"
        >
          <span class="empty__ico">
            <ion-icon :icon="calendarOutline" />
          </span>
          <h2 class="section-title">
            لم يتم تسجيل الوصول بعد
          </h2>
          <p class="muted">
            لا يوجد دور لك في طابور اليوم. بعد أن يسجّل الاستقبال وصولك في
            العيادة سيظهر هنا رقم دورك وكم حالة أمامك.
          </p>
          <router-link
            class="empty__link"
            :to="{ name: 'appointments' }"
          >
            عرض مواعيدي
          </router-link>
        </section>

        <template v-else>
          <!-- One clinic, one day: the banner is about the session, not about
               a particular child. -->
          <session-banner
            v-if="queue.session.value"
            :session="queue.session.value"
          />

          <turn-card
            v-for="item in queue.items.value"
            :key="item.childId"
            :item="item"
            :grace-minutes="graceMinutes"
            :max-self-defers="maxSelfDefers"
            :deferring="queue.deferring.value !== null"
            @grace-expired="queue.refresh()"
            @defer="(entryId) => (deferringEntry = entryId)"
          />

          <p class="foot">
            <template v-if="queue.session.value">
              متوسط وقت الكشف
              {{ arabicDigits(queue.session.value.avgConsultMinutes) }}
              دقائق لكل مريض ·
            </template>
            يتحدّث تلقائياً
          </p>
        </template>
      </template>
    </div>
    <clinic-dialog
      :open="deferringEntry !== null"
      title="تخطّي دورك"
      @close="deferringEntry = null"
    >
      <p class="muted confirm">
        سينتقل دورك خلف المريض التالي، ويبقى حجزك كما هو. هذه المرة ستُحتسب من
        مرات التأجيل المتاحة لك اليوم.
      </p>

      <template #actions>
        <ion-button
          fill="outline"
          size="small"
          @click="deferringEntry = null"
        >
          تراجع
        </ion-button>
        <ion-button
          size="small"
          @click="confirmDefer"
        >
          تأكيد التأجيل
        </ion-button>
      </template>
    </clinic-dialog>
  </screen-shell>
</template>

<style scoped>
.centre {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding-block: 28px;
}

.refresh {
  display: grid;
  place-items: center;
  inline-size: 40px;
  block-size: 40px;
  border-radius: var(--r-pill);
  border: 1.5px solid var(--line);
  background: var(--surface);
  color: var(--ink-2);
  font-size: 20px;
}

.refresh:disabled {
  opacity: 0.5;
}

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--coral-soft);
}

.notice__text {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--coral-ink);
}

.notice__retry {
  flex-shrink: 0;
  padding: 8px 16px;
  border-radius: var(--r-pill);
  border: none;
  background: var(--coral);
  color: #fff;
  font-family: var(--ff-body);
  font-weight: 700;
  font-size: 13.5px;
}

.empty__ico {
  display: grid;
  place-items: center;
  inline-size: 62px;
  block-size: 62px;
  border-radius: var(--r-pill);
  background: var(--coral-soft);
  color: var(--coral-ink);
  font-size: 30px;
}

.empty__link {
  font-weight: 700;
  color: var(--coral-ink);
  text-decoration: none;
}

.confirm {
  margin: 0;
  font-size: 14px;
}

.foot {
  margin: 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
}
</style>

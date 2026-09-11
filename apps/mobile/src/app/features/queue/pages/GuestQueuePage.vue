<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonIcon,
  IonSpinner,
  onIonViewDidLeave,
  onIonViewWillEnter,
} from '@ionic/vue';
import { refreshOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { ClinicSessionStatus, QueueStatus } from '@clinic/contracts';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import { arabicDigits } from '../../../shared/numerals';
import { useGuestQueue } from '../composables/useGuestQueue';

const route = useRoute();
const token = () => String(route.params['token'] ?? '');
const queue = useGuestQueue(token);

const title = computed(() => {
  switch (queue.view.value?.status) {
    case QueueStatus.Called:
      return 'حان دورك الآن!';
    case QueueStatus.InService:
      return 'أنت الآن داخل الكشف';
    case QueueStatus.Done:
      return 'تمت الزيارة';
    case QueueStatus.Missed:
      return 'فات دورك';
    case QueueStatus.Cancelled:
      return 'انتهى هذا الدور';
    default:
      return 'دورك محفوظ';
  }
});

const paused = computed(
  () => queue.view.value?.sessionStatus === ClinicSessionStatus.Paused,
);

onIonViewWillEnter(() => void queue.open());
onIonViewDidLeave(() => queue.close());
</script>

<template>
  <ScreenShell title="متابعة الدور" subtitle="تحديث تلقائي من العيادة">
    <template #header-end>
      <button
        class="guest-refresh"
        type="button"
        aria-label="تحديث"
        :disabled="queue.refreshing.value"
        @click="queue.refresh()"
      >
        <IonIcon :icon="refreshOutline" />
      </button>
    </template>

    <div class="guest-stack">
      <section v-if="queue.loading.value" class="card guest-loading">
        <IonSpinner name="crescent" />
        <p>جارٍ تحميل الدور…</p>
      </section>

      <section
        v-else-if="queue.failure.value"
        class="card guest-error"
        role="alert"
      >
        <h2>الرابط غير متاح</h2>
        <p>{{ queue.failure.value }}</p>
        <button type="button" @click="queue.refresh()">إعادة المحاولة</button>
      </section>

      <template v-else-if="queue.view.value">
        <p v-if="paused" class="guest-pause" role="status">
          الطابور متوقف مؤقتاً، وسيُستأنف التحديث عند عودة العمل.
        </p>

        <section class="card guest-turn" aria-live="polite">
          <p class="guest-turn__eyebrow">رقم دورك</p>
          <strong class="guest-turn__ticket">
            {{ arabicDigits(queue.view.value.ticketNumber) }}
          </strong>
          <h2>{{ title }}</h2>
          <p v-if="queue.view.value.status === QueueStatus.Waiting">
            أمامك
            <strong>{{ arabicDigits(queue.view.value.aheadCount) }}</strong>
            في الطابور
          </p>
        </section>

        <section class="guest-facts">
          <article class="card guest-fact">
            <span>يتم الكشف الآن</span>
            <strong>
              {{
                queue.view.value.nowServingTicketNumber === null
                  ? '—'
                  : arabicDigits(queue.view.value.nowServingTicketNumber)
              }}
            </strong>
          </article>
          <article class="card guest-fact">
            <span>الحالات أمامك</span>
            <strong>{{ arabicDigits(queue.view.value.aheadCount) }}</strong>
          </article>
        </section>

        <section class="guest-private">
          <IonIcon :icon="shieldCheckmarkOutline" />
          <p>
            هذا الرابط يعرض أرقام الدور فقط، ولا يعرض اسم المريض أو أي بيانات
            طبية.
          </p>
        </section>
      </template>
    </div>
  </ScreenShell>
</template>

<style scoped>
.guest-stack {
  display: grid;
  gap: 16px;
}
.guest-refresh {
  inline-size: 42px;
  block-size: 42px;
  border: 1.5px solid var(--line);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 20px;
}
.guest-loading,
.guest-error {
  min-block-size: 220px;
  padding: 26px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  text-align: center;
}
.guest-loading p,
.guest-error p {
  margin: 0;
  color: var(--ink-2);
  line-height: 1.7;
}
.guest-error h2 {
  margin: 0;
  font: 800 20px var(--ff-display);
}
.guest-error button {
  min-block-size: 44px;
  padding-inline: 22px;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--coral);
  color: white;
  font: 800 14px var(--ff-body);
}
.guest-pause {
  margin: 0;
  padding: 13px 15px;
  border-radius: var(--r-md);
  background: var(--sun-soft);
  color: #795510;
  font-weight: 700;
  line-height: 1.6;
}
.guest-turn {
  padding: 28px 20px;
  display: grid;
  justify-items: center;
  text-align: center;
  background: linear-gradient(160deg, var(--surface), var(--teal-soft));
}
.guest-turn__eyebrow {
  margin: 0;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 800;
}
.guest-turn__ticket {
  inline-size: 126px;
  block-size: 126px;
  margin-block: 9px;
  border: 10px solid rgb(255 255 255 / 80%);
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--teal);
  color: white;
  box-shadow: 0 10px 28px rgb(45 168 166 / 25%);
  font: 800 54px var(--ff-display);
}
.guest-turn h2 {
  margin: 0;
  font: 800 22px var(--ff-display);
}
.guest-turn p {
  margin: 5px 0 0;
  color: var(--ink-2);
  font-weight: 700;
}
.guest-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.guest-fact {
  min-width: 0;
  padding: 16px;
  display: grid;
  gap: 5px;
  text-align: center;
}
.guest-fact span {
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 700;
}
.guest-fact strong {
  color: var(--coral-ink);
  font: 800 26px var(--ff-display);
}
.guest-private {
  padding: 14px;
  border-radius: var(--r-md);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: var(--surface-2);
  color: var(--ink-2);
}
.guest-private ion-icon {
  flex: 0 0 auto;
  color: var(--teal-ink);
  font-size: 23px;
}
.guest-private p {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.65;
}
</style>

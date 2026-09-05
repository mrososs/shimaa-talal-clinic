<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  pauseCircleOutline,
  timeOutline,
} from 'ionicons/icons';
import {
  ClinicSessionStatus,
  DoctorPresence,
  type ParentSessionView,
} from '@clinic/contracts';
import { arabicDigits } from '../../../shared/numerals';

/**
 * The line a parent reads before anything else: is the clinic running, and is
 * the doctor here?
 *
 * Every word of it comes from what staff actually entered. When the doctor has
 * not arrived the banner says so plainly instead of counting down to a turn
 * that cannot come — the prototype's reassuring "الطابور يسير في موعده" is only
 * shown when it is true.
 */

const props = defineProps<{ session: ParentSessionView }>();

type Tone = 'ok' | 'warn' | 'muted';

const state = computed((): { tone: Tone; icon: string; title: string; note: string } => {
  const { status, doctorPresence, delayMinutes } = props.session;

  if (status === ClinicSessionStatus.Closed) {
    return {
      tone: 'muted',
      icon: timeOutline,
      title: 'انتهى عمل العيادة اليوم',
      note: 'راجعي الاستقبال لتحديد موعد جديد.',
    };
  }

  if (status === ClinicSessionStatus.Paused) {
    return {
      tone: 'warn',
      icon: pauseCircleOutline,
      title: 'الطابور متوقف مؤقتاً',
      note: 'مكانك محفوظ — سيُستأنف النداء بعد قليل.',
    };
  }

  if (doctorPresence === DoctorPresence.NotArrived) {
    return {
      tone: 'warn',
      icon: alertCircleOutline,
      title: 'الطبيبة لم تصل بعد',
      note: delay(delayMinutes) ?? 'سيبدأ النداء فور وصولها.',
    };
  }

  if (doctorPresence === DoctorPresence.EnRoute) {
    return {
      tone: 'warn',
      icon: timeOutline,
      title: 'الطبيبة في الطريق',
      note: delay(delayMinutes) ?? 'سيبدأ النداء فور وصولها.',
    };
  }

  if (doctorPresence === DoctorPresence.Expected) {
    return {
      tone: 'muted',
      icon: timeOutline,
      title: 'لم يبدأ النداء بعد',
      note: 'سيبدأ الطابور عند وصول الطبيبة.',
    };
  }

  return {
    tone: 'ok',
    icon: checkmarkCircleOutline,
    title: 'الطابور يسير في موعده',
    note: `متوسط وقت الكشف ${arabicDigits(props.session.avgConsultMinutes)} دقائق لكل مريض.`,
  };
});

/** Only ever what staff typed. Nothing here estimates a delay. */
function delay(minutes: number | null): string | null {
  return minutes === null || minutes <= 0
    ? null
    : `التأخير المتوقّع حوالي ${arabicDigits(minutes)} دقيقة.`;
}
</script>

<template>
  <div
    class="banner"
    :class="`banner--${state.tone}`"
  >
    <span class="banner__ico">
      <ion-icon :icon="state.icon" />
    </span>
    <div>
      <p class="banner__title">
        {{ state.title }}
      </p>
      <p class="banner__note">
        {{ state.note }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--r-lg);
}

.banner--ok {
  background: var(--teal-soft);
  color: var(--teal-ink);
}

.banner--warn {
  background: var(--sun-soft);
  color: var(--sun-ink);
}

.banner--muted {
  background: var(--surface-2);
  color: var(--ink-2);
}

.banner__ico {
  display: grid;
  place-items: center;
  font-size: 22px;
  flex-shrink: 0;
  margin-block-start: 1px;
}

.banner__title {
  margin: 0;
  font-family: var(--ff-display);
  font-weight: 800;
  font-size: 15.5px;
}

.banner__note {
  margin: 4px 0 0;
  font-size: 13.5px;
  line-height: 1.6;
  opacity: 0.85;
}
</style>

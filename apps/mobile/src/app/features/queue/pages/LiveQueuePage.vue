<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton, IonIcon } from '@ionic/vue';
import { timeOutline } from 'ionicons/icons';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import { session } from '../../../runtime';

/**
 * The live queue.
 *
 * The engine behind this does not exist yet, and this screen says so rather
 * than pretending. It is a tab in the design's own navigation, so removing it
 * would leave a hole where people expect one — but an empty state that explains
 * itself is honest, and a fake ticket number counting down is not.
 *
 * When the queue engine lands this becomes the real thing: patients ahead,
 * doctor presence, the grace countdown. Nothing here anticipates that beyond
 * saying it is coming.
 */

const router = useRouter();
const clinic = computed(() => session.state.identity?.clinic ?? null);
</script>

<template>
  <screen-shell
    title="الطابور"
    tabs
  >
    <div class="stack">
      <section class="card waiting">
        <span class="waiting__ico">
          <ion-icon :icon="timeOutline" />
        </span>
        <h2 class="waiting__title">
          العداد المباشر قريباً
        </h2>
        <p class="subtitle">
          بعد تسجيل حضورك في العيادة سيظهر هنا رقم دورك وكم مريضاً أمامك،
          محدَّثاً أولاً بأول.
        </p>
      </section>

      <section class="card note">
        <p class="subtitle">
          حتى ذلك الحين، تُسجَّل مواعيدك في العيادة كالمعتاد، ويسجّل الاستقبال
          حضورك عند وصولك إلى
          {{ clinic?.name ?? 'العيادة' }}.
        </p>
      </section>

      <div class="actions">
        <ion-button
          expand="block"
          @click="router.push({ name: 'appointments' })"
        >
          عرض مواعيدي
        </ion-button>
      </div>
    </div>
  </screen-shell>
</template>

<style scoped>
.waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 30px 22px;
}

.waiting__ico {
  width: 64px;
  height: 64px;
  border-radius: var(--r-pill);
  background: var(--sky-soft);
  color: #2b7fb0;
  display: grid;
  place-items: center;
  font-size: 30px;
}

.waiting__title {
  font-family: var(--ff-display);
  font-size: 19px;
  font-weight: 800;
  margin: 0;
}

.note {
  font-size: 13.5px;
  line-height: 1.8;
}
</style>

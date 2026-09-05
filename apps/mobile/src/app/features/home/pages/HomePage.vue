<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonContent,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  type RefresherCustomEvent,
} from '@ionic/vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { session } from '../../../runtime';

/**
 * Home: who is signed in, and which children they act for.
 *
 * Booking and the live queue land here as they are built. Nothing on this
 * screen is a placeholder for them — an inert "book" button that does nothing
 * is worse than an honest absence.
 */

const router = useRouter();
const state = session.state;
const signingOut = ref(false);

const guardian = computed(() => state.identity?.guardian ?? null);
const children = computed(() => state.identity?.children ?? []);
const clinic = computed(() => state.identity?.clinic ?? null);

const identityFailure = computed(() =>
  state.identityError === null
    ? null
    : state.identityError === 'forbidden'
      ? 'هذا الحساب لا يملك صلاحية هنا.'
      : 'تعذَّر تحميل بياناتك. تحقّقي من الاتصال وأعيدي المحاولة.',
);

/** Years and months, the way a parent says a child's age. */
function ageLabel(dateOfBirth: string | null): string | null {
  if (dateOfBirth === null) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;

  const now = new Date();
  let months =
    (now.getFullYear() - born.getFullYear()) * 12 +
    (now.getMonth() - born.getMonth());
  if (now.getDate() < born.getDate()) months -= 1;
  if (months < 0) return null;

  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (years === 0) return `${remainder} شهر`;
  if (remainder === 0) return `${years} سنة`;
  return `${years} سنة و${remainder} شهر`;
}

async function refresh(event?: RefresherCustomEvent): Promise<void> {
  await session.refreshIdentity();
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
</script>

<template>
  <ion-page>
    <ion-content>
      <ion-refresher
        slot="fixed"
        @ion-refresh="refresh($event)"
      >
        <ion-refresher-content />
      </ion-refresher>

      <div class="clinic-page home">
        <header class="home__header">
          <p class="home__clinic">
            {{ clinic?.name ?? 'عيادة د. شيماء طلال' }}
          </p>
          <h1 class="clinic-title">
            {{ guardian ? `أهلاً ${guardian.fullName}` : 'أهلاً بك' }}
          </h1>
        </header>

        <form-notice :message="identityFailure" />
        <div
          v-if="identityFailure"
          class="clinic-actions"
        >
          <ion-button
            fill="outline"
            expand="block"
            @click="refresh()"
          >
            إعادة المحاولة
          </ion-button>
        </div>

        <section
          v-if="children.length > 0"
          class="clinic-stack"
        >
          <h2 class="section-title">
            أطفالك
          </h2>
          <article
            v-for="child in children"
            :key="child.id"
            class="clinic-card child"
          >
            <div>
              <p class="child__name">
                {{ child.fullName }}
              </p>
              <p
                v-if="ageLabel(child.dateOfBirth)"
                class="clinic-muted child__age"
              >
                {{ ageLabel(child.dateOfBirth) }}
              </p>
            </div>
          </article>
        </section>

        <div class="clinic-actions">
          <ion-button
            fill="clear"
            expand="block"
            color="medium"
            :disabled="signingOut"
            @click="signOut"
          >
            <ion-spinner
              v-if="signingOut"
              name="crescent"
            />
            <span v-else>تسجيل الخروج</span>
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.home {
  max-width: 560px;
  margin-inline: auto;
}

.home__header {
  margin-block-end: var(--clinic-space-lg);
}

.home__clinic {
  color: var(--ion-color-primary);
  font-weight: 700;
  margin: 0 0 var(--clinic-space-xs);
}

.section-title {
  font-size: 1rem;
  font-weight: 700;
  margin: 0;
}

.child {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.child__name {
  margin: 0;
  font-weight: 600;
}

.child__age {
  margin: var(--clinic-space-xs) 0 0;
  font-size: 0.85rem;
}
</style>

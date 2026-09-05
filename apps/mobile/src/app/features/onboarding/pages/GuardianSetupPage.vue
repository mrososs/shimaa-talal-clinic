<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonContent,
  IonInput,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
} from '@ionic/vue';
import { GuardianRelationship } from '@clinic/contracts';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { apiMessage } from '../../../shared/messages';
import { identityApi, session } from '../../../runtime';

/**
 * The clinic profile, created after the account exists.
 *
 * The phone is asked for here and not on the signup screen, because it is not a
 * credential — it is how the clinic finds this family, and it may already be on
 * file from a phone call made months ago.
 *
 * Which is why submitting does not create anything straight away. It asks the
 * clinic whether that number is already known, and routes to the claim screen
 * if it is. Creating a second profile for a family the clinic already has is
 * the duplicate this MVP has no tool to merge.
 */

const RELATIONSHIPS = [
  { value: GuardianRelationship.Mother, label: 'الأم' },
  { value: GuardianRelationship.Father, label: 'الأب' },
  { value: GuardianRelationship.Grandparent, label: 'الجد/الجدة' },
  { value: GuardianRelationship.Other, label: 'أخرى' },
] as const;

const router = useRouter();
const fullName = ref('');
const phone = ref('');
const relationship = ref<GuardianRelationship>(GuardianRelationship.Mother);
const submitted = ref(false);
const pending = ref(false);
const failure = ref<string | null>(null);

const nameError = computed(() =>
  !submitted.value || fullName.value.trim().length >= 2
    ? null
    : 'أدخلي الاسم كاملاً.',
);
const phoneError = computed(() =>
  !submitted.value || /^[\d\s+-]{6,}$/.test(phone.value.trim())
    ? null
    : 'أدخلي رقم هاتف صحيح. مثال: ٠١٠١٢٣٤٥٦٧٨',
);
const invalid = computed(
  () => nameError.value !== null || phoneError.value !== null,
);

async function submit(): Promise<void> {
  submitted.value = true;
  failure.value = null;
  if (invalid.value) return;

  pending.value = true;
  try {
    const typed = phone.value.trim();
    const { matchFound } = await identityApi.claimRequest(typed);

    if (matchFound) {
      // The clinic knows this number. A match alone grants nothing — the code
      // reception issues is what authorises the link.
      await router.push({
        name: 'onboarding-claim',
        query: { phone: typed },
      });
      return;
    }

    await identityApi.createGuardian({
      fullName: fullName.value.trim(),
      phone: typed,
      relationship: relationship.value,
    });
    await session.refreshIdentity();
    await router.replace({ name: 'onboarding-child' });
  } catch (error) {
    failure.value = apiMessage(error);
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <ion-page>
    <ion-content>
      <div class="clinic-page onboarding">
        <header>
          <h1 class="clinic-title">
            بياناتك لدى العيادة
          </h1>
          <p class="clinic-subtitle">
            نستخدم رقم هاتفك للعثور على ملف عائلتك عند الاتصال أو الحضور.
          </p>
        </header>

        <form
          class="clinic-stack"
          novalidate
          @submit.prevent="submit"
        >
          <ion-input
            v-model="fullName"
            label="الاسم بالكامل"
            label-placement="stacked"
            autocomplete="name"
            fill="outline"
            :class="{ 'ion-invalid': nameError, 'ion-touched': submitted }"
            :error-text="nameError ?? undefined"
          />

          <ion-input
            v-model="phone"
            label="رقم الهاتف"
            label-placement="stacked"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            fill="outline"
            :class="{ 'ion-invalid': phoneError, 'ion-touched': submitted }"
            :error-text="phoneError ?? undefined"
          />

          <div>
            <p class="clinic-muted field-label">
              صلة القرابة
            </p>
            <ion-segment v-model="relationship">
              <ion-segment-button
                v-for="option in RELATIONSHIPS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </ion-segment-button>
            </ion-segment>
          </div>

          <form-notice :message="failure" />

          <div class="clinic-actions">
            <ion-button
              type="submit"
              expand="block"
              size="large"
              :disabled="pending"
            >
              <ion-spinner
                v-if="pending"
                name="crescent"
              />
              <span v-else>متابعة</span>
            </ion-button>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.onboarding {
  max-width: 480px;
  margin-inline: auto;
}

.field-label {
  margin: 0 0 var(--clinic-space-sm);
  font-size: 0.85rem;
}
</style>

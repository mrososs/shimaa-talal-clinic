<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
 * Phone-OTP accounts arrive with a verified number and cannot accidentally
 * type a different one here. Email accounts still provide the clinic contact
 * number during onboarding.
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
const route = useRoute();

// Registration already asked for a name. Typing it twice would be an odd
// welcome, so it arrives in the route and is prefilled here.
const fullName = ref(String(route.query['name'] ?? ''));
const verifiedPhone = computed(() => session.state.session?.phone ?? null);
const phone = ref(verifiedPhone.value ?? '');
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
    <ion-content class="safe-content">
      <div class="screen onboarding">
        <header>
          <h1 class="title">
            بياناتك لدى العيادة
          </h1>
          <p class="subtitle">
            نستخدم رقم هاتفك للعثور على ملف عائلتك عند الاتصال أو الحضور.
          </p>
        </header>

        <form
          class="stack"
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
            :readonly="verifiedPhone !== null"
            :class="{ 'ion-invalid': phoneError, 'ion-touched': submitted }"
            :error-text="phoneError ?? undefined"
          />
          <p
            v-if="verifiedPhone"
            class="verified-phone"
          >
            ✓ تم التحقق من هذا الرقم برسالة SMS
          </p>

          <div>
            <p class="subtle field-label">
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

          <div class="actions">
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
  margin: 0 0 8px;
  font-size: 0.85rem;
}

.verified-phone {
  margin: -8px 4px 0;
  color: var(--teal-ink);
  font-size: 12.5px;
  font-weight: 800;
}
</style>

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
import FormNotice from '../../../shared/components/FormNotice.vue';
import { apiMessage } from '../../../shared/messages';
import { identityApi, session } from '../../../runtime';

/**
 * The first child, which is what makes the app useful.
 *
 * A guardian with no children cannot book anything, so the guard sends people
 * here until one exists. Date of birth is optional and stays optional — the
 * clinic often books before knowing it, and demanding it here would block
 * onboarding over something reception fills in later.
 */

const SEXES = [
  { value: 'female', label: 'أنثى' },
  { value: 'male', label: 'ذكر' },
] as const;

const router = useRouter();
const fullName = ref('');
const dateOfBirth = ref('');
const sex = ref<'male' | 'female' | ''>('');
const submitted = ref(false);
const pending = ref(false);
const failure = ref<string | null>(null);

const nameError = computed(() =>
  !submitted.value || fullName.value.trim().length >= 1
    ? null
    : 'أدخلي اسم الطفل.',
);

/** Empty is fine. A date that is not a date, or in the future, is not. */
const dobError = computed(() => {
  if (!submitted.value || dateOfBirth.value === '') return null;
  const parsed = Date.parse(dateOfBirth.value);
  if (Number.isNaN(parsed)) return 'أدخلي تاريخاً صحيحاً.';
  return parsed > Date.now() ? 'تاريخ الميلاد لا يكون في المستقبل.' : null;
});

const invalid = computed(
  () => nameError.value !== null || dobError.value !== null,
);

async function submit(): Promise<void> {
  submitted.value = true;
  failure.value = null;
  if (invalid.value) return;

  pending.value = true;
  try {
    await identityApi.createChild({
      fullName: fullName.value.trim(),
      ...(dateOfBirth.value === ''
        ? {}
        : { dateOfBirth: dateOfBirth.value }),
      ...(sex.value === '' ? {} : { sex: sex.value }),
    });
    await session.refreshIdentity();
    await router.replace({ name: 'home' });
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
      <div class="screen onboarding">
        <header>
          <h1 class="title">
            بيانات طفلك
          </h1>
          <p class="subtitle">
            يمكنك إضافة بقية الأطفال لاحقاً من الصفحة الرئيسية.
          </p>
        </header>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <ion-input
            v-model="fullName"
            label="اسم الطفل"
            label-placement="stacked"
            fill="outline"
            :class="{ 'ion-invalid': nameError, 'ion-touched': submitted }"
            :error-text="nameError ?? undefined"
          />

          <ion-input
            v-model="dateOfBirth"
            label="تاريخ الميلاد (اختياري)"
            label-placement="stacked"
            type="date"
            fill="outline"
            :class="{ 'ion-invalid': dobError, 'ion-touched': submitted }"
            :error-text="dobError ?? undefined"
          />

          <div>
            <p class="subtle field-label">
              النوع (اختياري)
            </p>
            <ion-segment v-model="sex">
              <ion-segment-button
                v-for="option in SEXES"
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
              <span v-else>حفظ ومتابعة</span>
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
</style>

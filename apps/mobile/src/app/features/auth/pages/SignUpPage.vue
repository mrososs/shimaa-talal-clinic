<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonContent,
  IonInput,
  IonPage,
  IonSpinner,
} from '@ionic/vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { authMessage } from '../../../shared/messages';
import { session } from '../../../runtime';

/**
 * Create an account: email, password, confirm.
 *
 * No phone here. The phone belongs to the clinic profile on the next screen —
 * mixing it into account creation is what makes people believe the number is
 * what signs them in.
 */

const MIN_PASSWORD_LENGTH = 8;

const router = useRouter();
const email = ref('');
const password = ref('');
const confirmation = ref('');
const submitted = ref(false);
const awaitingConfirmation = ref(false);

const state = session.state;
const serverError = computed(() => authMessage(state.authError));

const emailError = computed(() =>
  !submitted.value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())
    ? null
    : 'أدخلي بريداً إلكترونياً صحيحاً.',
);
const passwordError = computed(() =>
  !submitted.value || password.value.length >= MIN_PASSWORD_LENGTH
    ? null
    : 'كلمة المرور ٨ أحرف على الأقل.',
);
const confirmationError = computed(() =>
  !submitted.value || confirmation.value === password.value
    ? null
    : 'كلمتا المرور غير متطابقتين.',
);
const invalid = computed(
  () =>
    emailError.value !== null ||
    passwordError.value !== null ||
    confirmationError.value !== null,
);

async function submit(): Promise<void> {
  submitted.value = true;
  awaitingConfirmation.value = false;
  if (invalid.value) return;

  const signedIn = await session.signUp({
    email: email.value.trim(),
    password: password.value,
  });

  if (signedIn) {
    await router.replace({ name: 'home' });
    return;
  }

  // No session was issued. Supabase answers the same way for an address that
  // already exists — deliberately, so signup cannot be used to discover who has
  // an account — so this must not claim the account was created.
  if (state.authError === null) awaitingConfirmation.value = true;
}
</script>

<template>
  <ion-page>
    <ion-content>
      <div class="clinic-page auth">
        <header class="auth__header">
          <p class="auth__clinic">
            عيادة د. شيماء طلال
          </p>
          <h1 class="clinic-title">
            إنشاء حساب
          </h1>
          <p class="clinic-subtitle">
            حسابٌ واحد لمتابعة مواعيد أطفالك ودورك في العيادة.
          </p>
        </header>

        <form
          class="clinic-stack"
          novalidate
          @submit.prevent="submit"
        >
          <ion-input
            v-model="email"
            label="البريد الإلكتروني"
            label-placement="stacked"
            type="email"
            inputmode="email"
            autocomplete="email"
            fill="outline"
            :class="{ 'ion-invalid': emailError, 'ion-touched': submitted }"
            :error-text="emailError ?? undefined"
          />

          <ion-input
            v-model="password"
            label="كلمة المرور"
            label-placement="stacked"
            type="password"
            autocomplete="new-password"
            fill="outline"
            :class="{ 'ion-invalid': passwordError, 'ion-touched': submitted }"
            :error-text="passwordError ?? undefined"
          />

          <ion-input
            v-model="confirmation"
            label="تأكيد كلمة المرور"
            label-placement="stacked"
            type="password"
            autocomplete="new-password"
            fill="outline"
            :class="{
              'ion-invalid': confirmationError,
              'ion-touched': submitted,
            }"
            :error-text="confirmationError ?? undefined"
          />

          <form-notice :message="serverError" />
          <form-notice
            tone="info"
            :message="
              awaitingConfirmation
                ? 'تحقّقي من بريدك الإلكتروني لتأكيد الحساب، ثم سجّلي الدخول.'
                : null
            "
          />

          <div class="clinic-actions">
            <ion-button
              type="submit"
              expand="block"
              size="large"
              :disabled="state.pending"
            >
              <ion-spinner
                v-if="state.pending"
                name="crescent"
              />
              <span v-else>إنشاء الحساب</span>
            </ion-button>

            <ion-button
              fill="clear"
              expand="block"
              :disabled="state.pending"
              @click="router.push({ name: 'sign-in' })"
            >
              لديك حساب بالفعل؟ سجّلي الدخول
            </ion-button>
          </div>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.auth {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100%;
  max-width: 480px;
  margin-inline: auto;
}

.auth__header {
  margin-block-end: var(--clinic-space-lg);
}

.auth__clinic {
  color: var(--ion-color-primary);
  font-weight: 700;
  margin: 0 0 var(--clinic-space-sm);
}
</style>

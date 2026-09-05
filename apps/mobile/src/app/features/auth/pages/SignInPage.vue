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
 * Sign in with an email and a password.
 *
 * Not a phone and a one-time code. The design shows that flow and it is the
 * eventual one, but phone ownership is unverified in this MVP and an SMS
 * provider is out of scope — so the account is an email account, and the phone
 * stays what it actually is here: the clinic's way of finding a family.
 */

const router = useRouter();
const email = ref('');
const password = ref('');
const submitted = ref(false);

const state = session.state;
const serverError = computed(() => authMessage(state.authError));

const emailError = computed(() =>
  !submitted.value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())
    ? null
    : 'أدخلي بريداً إلكترونياً صحيحاً.',
);
const passwordError = computed(() =>
  !submitted.value || password.value.length > 0
    ? null
    : 'أدخلي كلمة المرور.',
);
const invalid = computed(
  () => emailError.value !== null || passwordError.value !== null,
);

async function submit(): Promise<void> {
  submitted.value = true;
  if (invalid.value) return;

  const ok = await session.signIn({
    email: email.value.trim(),
    password: password.value,
  });

  // The guard decides where a signed-in parent belongs — home, onboarding, or
  // adding a first child. This page does not need to know which.
  if (ok) await router.replace({ name: 'home' });
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
            أهلاً بعودتك
          </h1>
          <p class="clinic-subtitle">
            سجّلي الدخول لمتابعة مواعيد أطفالك.
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
            autocomplete="current-password"
            fill="outline"
            :class="{ 'ion-invalid': passwordError, 'ion-touched': submitted }"
            :error-text="passwordError ?? undefined"
          />

          <form-notice :message="serverError" />

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
              <span v-else>تسجيل الدخول</span>
            </ion-button>

            <ion-button
              fill="clear"
              expand="block"
              :disabled="state.pending"
              @click="router.push({ name: 'sign-up' })"
            >
              ليس لديك حساب؟ أنشئي حساباً
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

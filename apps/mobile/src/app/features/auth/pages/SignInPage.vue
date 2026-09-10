<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonPage,
  IonSpinner,
} from '@ionic/vue';
import {
  eyeOffOutline,
  eyeOutline,
  lockClosedOutline,
  mailOutline,
} from 'ionicons/icons';
import AuthHero from '../../../shared/components/AuthHero.vue';
import FieldRow from '../../../shared/components/FieldRow.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { authMessage } from '../../../shared/messages';
import { session } from '../../../runtime';

/**
 * Email/password is the release authentication path. Phone OTP is deliberately
 * deferred to the next product phase, so this screen must not advertise a
 * route that the deployed Supabase project cannot deliver yet.
 */

const router = useRouter();
const email = ref('');
const password = ref('');
const revealed = ref(false);
const submitted = ref(false);

const state = session.state;

// The store outlives this screen: an error raised on the other auth page would
// otherwise greet someone who has typed nothing yet.
onMounted(() => session.clearAuthError());
const serverError = computed(() => authMessage(state.authError));

const emailError = computed(() =>
  !submitted.value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())
    ? null
    : 'أدخلي بريداً إلكترونياً صحيحاً.',
);
const passwordError = computed(() =>
  !submitted.value || password.value.length > 0 ? null : 'أدخلي كلمة المرور.',
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
      <auth-hero />

      <div class="screen auth pop">
        <header class="auth__intro">
          <h2 class="title">
            أهلاً بعودتك 👋
          </h2>
          <p class="subtitle">
            سجّلي الدخول بالبريد الإلكتروني وكلمة المرور للوصول إلى مواعيد
            وملفات أطفالك.
          </p>
        </header>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <field-row
            for-id="sign-in-email"
            label="البريد الإلكتروني"
            :icon="mailOutline"
            :error="emailError"
          >
            <input
              id="sign-in-email"
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="name@email.com"
              dir="ltr"
              :aria-invalid="emailError !== null"
              :aria-describedby="
                emailError ? 'sign-in-email-message' : undefined
              "
            >
          </field-row>

          <field-row
            for-id="sign-in-password"
            label="كلمة المرور"
            :icon="lockClosedOutline"
            :error="passwordError"
          >
            <input
              id="sign-in-password"
              v-model="password"
              :type="revealed ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="••••••••"
              dir="ltr"
              :aria-invalid="passwordError !== null"
              :aria-describedby="
                passwordError ? 'sign-in-password-message' : undefined
              "
            >
            <template #end>
              <button
                type="button"
                class="reveal"
                :aria-label="
                  revealed ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
                "
                @click="revealed = !revealed"
              >
                <ion-icon :icon="revealed ? eyeOffOutline : eyeOutline" />
              </button>
            </template>
          </field-row>

          <button
            type="button"
            class="forgot"
            @click="router.push({ name: 'reset-password' })"
          >
            نسيتِ كلمة المرور؟
          </button>

          <form-notice :message="serverError" />

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

          <p class="auth__switch">
            ليس لديك حساب؟
            <button
              type="button"
              class="auth__link"
              @click="router.push({ name: 'sign-up' })"
            >
              إنشاء حساب جديد
            </button>
          </p>
        </form>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.auth {
  padding-block-start: 24px;
}

.auth__intro {
  margin-block-end: 20px;
}

.forgot {
  justify-self: start;
  min-block-size: 32px;
  border: none;
  background: none;
  padding: 0;
  color: var(--coral-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.reveal {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--ink-2);
  display: grid;
  place-items: center;
  font-size: 18px;
  cursor: pointer;
}

.auth__switch {
  text-align: center;
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 700;
  margin-block-start: 8px;
}

.auth__link {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: 800;
  color: var(--coral);
  cursor: pointer;
}
</style>

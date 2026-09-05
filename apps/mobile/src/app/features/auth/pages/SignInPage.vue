<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton, IonContent, IonIcon, IonPage, IonSpinner } from '@ionic/vue';
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
 * Sign in with an email and a password.
 *
 * Not a phone and a one-time code. The design shows that flow and it is the
 * eventual one, but phone ownership is unverified in this MVP and an SMS
 * provider is out of scope — so the account is an email account, and the phone
 * stays what it actually is here: the clinic's way of finding a family.
 *
 * The design's "الدخول برقم الجوال" button is therefore absent rather than
 * present and inert. A control that does nothing teaches people not to trust
 * the ones that do.
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
            label="البريد الإلكتروني"
            :icon="mailOutline"
            :error="emailError"
          >
            <input
              v-model="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="name@email.com"
              dir="ltr"
            >
          </field-row>

          <field-row
            label="كلمة المرور"
            :icon="lockClosedOutline"
            :error="passwordError"
          >
            <input
              v-model="password"
              :type="revealed ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="••••••••"
              dir="ltr"
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

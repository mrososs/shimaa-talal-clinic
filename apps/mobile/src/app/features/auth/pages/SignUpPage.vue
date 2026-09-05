<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonButton, IonContent, IonIcon, IonPage, IonSpinner } from '@ionic/vue';
import {
  eyeOffOutline,
  eyeOutline,
  lockClosedOutline,
  mailOutline,
  personOutline,
} from 'ionicons/icons';
import AuthHero from '../../../shared/components/AuthHero.vue';
import FieldRow from '../../../shared/components/FieldRow.vue';
import FormNotice from '../../../shared/components/FormNotice.vue';
import { authMessage } from '../../../shared/messages';
import { session } from '../../../runtime';

/**
 * Create an account: name, email, password.
 *
 * The design asks for a name here, and it is worth collecting: it is what the
 * next screen greets someone with, and typing it twice would be an odd welcome.
 * It is carried forward to guardian onboarding rather than sent to Supabase —
 * the account is credentials, the clinic profile is a separate thing.
 *
 * No phone. The phone belongs to the clinic profile on the next screen; mixing
 * it into account creation is what makes people believe the number signs them
 * in.
 */

const MIN_PASSWORD_LENGTH = 8;

const router = useRouter();
const fullName = ref('');
const email = ref('');
const password = ref('');
const revealed = ref(false);
const submitted = ref(false);
const awaitingConfirmation = ref(false);

const state = session.state;

onMounted(() => session.clearAuthError());
const serverError = computed(() => authMessage(state.authError));

const nameError = computed(() =>
  !submitted.value || fullName.value.trim().length >= 2
    ? null
    : 'أدخلي الاسم كاملاً.',
);
const emailError = computed(() =>
  !submitted.value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())
    ? null
    : 'أدخلي بريداً إلكترونياً صحيحاً.',
);
const passwordError = computed(() =>
  !submitted.value || password.value.length >= MIN_PASSWORD_LENGTH
    ? null
    : `كلمة المرور ٨ أحرف على الأقل.`,
);
const invalid = computed(
  () =>
    nameError.value !== null ||
    emailError.value !== null ||
    passwordError.value !== null,
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
    // Carried in the route, not in the store: it is a convenience for the very
    // next screen, and it should not outlive this flow.
    await router.replace({
      name: 'onboarding-guardian',
      query: { name: fullName.value.trim() },
    });
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
      <auth-hero />

      <div class="screen auth pop">
        <header class="auth__intro">
          <h2 class="title">
            إنشاء حساب جديد
          </h2>
          <p class="subtitle">
            حسابٌ واحد لمتابعة مواعيد أطفالك ودورك في العيادة.
          </p>
        </header>

        <form
          class="stack"
          novalidate
          @submit.prevent="submit"
        >
          <field-row
            label="الاسم الكامل"
            :icon="personOutline"
            :error="nameError"
          >
            <input
              v-model="fullName"
              type="text"
              autocomplete="name"
              placeholder="مثال: منى عبدالله"
            >
          </field-row>

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
            hint="٨ أحرف على الأقل"
          >
            <input
              v-model="password"
              :type="revealed ? 'text' : 'password'"
              autocomplete="new-password"
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
          <form-notice
            tone="info"
            :message="
              awaitingConfirmation
                ? 'تحقّقي من بريدك الإلكتروني لتأكيد الحساب، ثم سجّلي الدخول.'
                : null
            "
          />

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
            <span v-else>متابعة</span>
          </ion-button>

          <p class="auth__switch">
            لديك حساب بالفعل؟
            <button
              type="button"
              class="auth__link"
              @click="router.push({ name: 'sign-in' })"
            >
              سجّلي الدخول
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

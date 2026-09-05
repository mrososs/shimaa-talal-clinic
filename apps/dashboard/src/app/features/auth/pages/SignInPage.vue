<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { authMessage } from '../../../shared/messages';
import { session } from '../../../runtime';

/**
 * Staff sign-in.
 *
 * There is no registration screen and there will not be one. Staff accounts are
 * created by an admin and matched to a clinic membership — a public signup form
 * on a clinic dashboard would let anyone create an account that then has to be
 * refused, which is a worse experience than not offering it.
 */

const router = useRouter();
const email = ref('');
const password = ref('');
const submitted = ref(false);

const state = session.state;

// The store outlives this screen: an error raised on the other auth page
// would otherwise greet someone who has typed nothing yet.
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

async function submit(): Promise<void> {
  submitted.value = true;
  if (emailError.value !== null || passwordError.value !== null) return;

  const ok = await session.signIn({
    email: email.value.trim(),
    password: password.value,
  });

  // A signed-in account with no clinic membership still lands in the shell,
  // which is where "no clinic access" is said. That is not this page's job.
  if (ok) await router.replace({ name: 'overview' });
}
</script>

<template>
  <div class="signin">
    <form
      class="dcard dcard--pad dstack signin__form"
      novalidate
      @submit.prevent="submit"
    >
      <header>
        <p class="signin__clinic">
          عيادة د. شيماء طلال
        </p>
        <h1>
          لوحة العيادة
        </h1>
        <p class="dmuted">
          سجّلي الدخول للوصول إلى المواعيد والطابور.
        </p>
      </header>

      <label class="dfield">
        <span class="dfield__label">البريد الإلكتروني</span>
        <input
          v-model="email"
          class="dinput"
          type="email"
          autocomplete="username"
          :aria-invalid="emailError !== null"
        >
        <span
          v-if="emailError"
          class="signin__error"
        >{{ emailError }}</span>
      </label>

      <label class="dfield">
        <span class="dfield__label">كلمة المرور</span>
        <input
          v-model="password"
          class="dinput"
          type="password"
          autocomplete="current-password"
          :aria-invalid="passwordError !== null"
        >
        <span
          v-if="passwordError"
          class="signin__error"
        >{{ passwordError }}</span>
      </label>

      <p
        v-if="serverError"
        class="dnotice dnotice--error"
        role="alert"
      >
        {{ serverError }}
      </p>

      <button
        class="dbtn dbtn--primary dbtn--block"
        type="submit"
        :disabled="state.pending"
      >
        {{ state.pending ? '...' : 'تسجيل الدخول' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.signin {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 16px;
}

.signin__form {
  width: min(420px, 100%);
}

.signin__clinic {
  margin: 0 0 4px;
  color: var(--coral-ink);
  font-weight: 700;
}

.signin__error {
  color: var(--danger);
  font-size: 0.85rem;
}
</style>

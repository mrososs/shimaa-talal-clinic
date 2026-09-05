<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { session } from '../runtime';
import { navigationFor } from './navigation';

/**
 * The frame every staff screen renders inside.
 *
 * Three regions, from the design: a sidebar on the reading-start side, a top
 * bar that names where you are, and the scrolling content. The sidebar and the
 * top bar are the shell's job precisely so a screen never has to restate them —
 * a page that drew its own header would drift from the others.
 *
 * It also owns the two states that are not screens: an account with no clinic
 * membership, and an identity that could not be loaded. Both are reachable by
 * signing in correctly, so neither is an error page.
 */

const router = useRouter();
const route = useRoute();
const state = session.state;
const signingOut = ref(false);

const member = computed(() => state.identity?.member ?? null);
const clinic = computed(() => state.identity?.clinic ?? null);
const links = computed(() => navigationFor(member.value?.role ?? null));

const ROLE_LABELS: Record<string, string> = {
  doctor: 'الطبيبة',
  // The clinic's own word for this role. The stored value stays `reception`.
  reception: 'مساعدة العيادة',
  admin: 'مسؤول',
};

/** The clinic's initial, for the brand tile. */
const brandInitial = computed(() => clinic.value?.name?.trim().at(0) ?? 'ع');

/** What the top bar says. Read from the route so a screen cannot forget it. */
const heading = computed(() => ({
  title: (route.meta['title'] as string | undefined) ?? '',
  subtitle: route.meta['subtitle'] as string | undefined,
}));

/** Today, in the clinic's own zone — never the browser's. */
const todayLabel = computed(() => {
  const value = clinic.value;
  if (value === null) return '';
  return new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: value.timezone,
  }).format(new Date(`${value.today}T12:00:00Z`));
});

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
  <div class="dash">
    <aside
      v-if="member"
      class="dash-side"
    >
      <div class="dash-brand">
        <div class="dash-brand__logo">
          {{ brandInitial }}
        </div>
        <div>
          <p class="dash-brand__name">
            {{ clinic?.name ?? 'العيادة' }}
          </p>
          <p class="dash-brand__role">
            {{ member.displayName }} ·
            {{ ROLE_LABELS[member.role] ?? member.role }}
          </p>
        </div>
      </div>

      <nav class="dash-nav">
        <!--
          Matched by name rather than with `active-class`. That matches
          inclusively, so the index route ('' under '/') lights up on every
          child page and two links read as current at once.
        -->
        <router-link
          v-for="link in links"
          :key="link.name"
          class="dash-navbtn"
          :class="{ 'dash-navbtn--active': route.name === link.name }"
          :aria-current="route.name === link.name ? 'page' : undefined"
          :to="{ name: link.name }"
        >
          {{ link.label }}
        </router-link>
      </nav>

      <button
        class="dbtn dbtn--ghost dbtn--block"
        :disabled="signingOut"
        @click="signOut"
      >
        {{ signingOut ? '...' : 'تسجيل الخروج' }}
      </button>
    </aside>

    <main class="dash-main">
      <section
        v-if="state.identityError === 'forbidden'"
        class="dash-blocked"
      >
        <div class="dcard dcard--pad dstack">
          <h1>لا صلاحية لهذا الحساب</h1>
          <p class="dmuted">
            هذا الحساب ليس مسجَّلاً ضمن فريق العيادة. إن كنتِ من الفريق،
            تواصلي مع مسؤول العيادة لإضافة حسابك.
          </p>
          <button
            class="dbtn dbtn--ghost"
            :disabled="signingOut"
            @click="signOut"
          >
            تسجيل الخروج
          </button>
        </div>
      </section>

      <section
        v-else-if="state.identityError === 'unavailable'"
        class="dash-blocked"
      >
        <div class="dcard dcard--pad dstack">
          <h1>تعذَّر الاتصال بالخادم</h1>
          <p class="dmuted">
            لم نتمكن من تحميل بيانات العيادة. تحقّقي من الاتصال ثم أعيدي
            المحاولة.
          </p>
          <button
            class="dbtn dbtn--primary"
            @click="session.refreshIdentity()"
          >
            إعادة المحاولة
          </button>
        </div>
      </section>

      <template v-else>
        <header class="dash-top">
          <div class="dash-top__title">
            <h1>{{ heading.title }}</h1>
            <p v-if="heading.subtitle">
              {{ heading.subtitle }}
            </p>
          </div>
          <span class="dpill dash-top__today">{{ todayLabel }}</span>
        </header>

        <!--
          The scroll container, and the only place page padding is defined. A
          screen that set its own would drift from every other one.
        -->
        <div class="dash-content">
          <router-view />
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.dash-blocked {
  display: grid;
  place-items: center;
  min-height: 70vh;
  padding: 24px;
}

.dash-blocked .dcard {
  max-width: 460px;
}

.dash-top__today {
  margin-inline-start: auto;
}

@media (max-width: 860px) {
  .dash {
    flex-direction: column;
  }

  .dash-side {
    width: 100%;
    border-inline-end: none;
    border-block-end: 1px solid var(--line);
  }

  .dash-nav {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .dash-content {
    padding: 18px;
  }
}
</style>

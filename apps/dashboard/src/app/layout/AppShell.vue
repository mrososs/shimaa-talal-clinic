<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { session } from '../runtime';
import DashboardSidebar from './components/DashboardSidebar.vue';
import DashboardTopbar from './components/DashboardTopbar.vue';

/**
 * The frame every staff screen renders inside.
 *
 * Three regions, from the design: a sidebar on the reading-start side, a top
 * bar that names where you are, and the scrolling content. The fixed sidebar and the
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
const signingOut = shallowRef(false);

const member = computed(() => state.identity?.member ?? null);
const clinic = computed(() => state.identity?.clinic ?? null);

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
    <DashboardSidebar
      v-if="member"
      :member="member"
      :clinic-name="clinic?.name ?? 'العيادة'"
      :active-route-name="route.name"
      :signing-out="signingOut"
      @sign-out="signOut"
    />

    <main class="dash-main">
      <section
        v-if="state.identityError === 'forbidden'"
        class="dash-blocked"
      >
        <div class="dcard dcard--pad dstack">
          <h1>لا صلاحية لهذا الحساب</h1>
          <p class="dmuted">
            هذا الحساب ليس مسجَّلاً ضمن فريق العيادة. إن كنتِ من الفريق، تواصلي
            مع مسؤول العيادة لإضافة حسابك.
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
        <DashboardTopbar
          :title="heading.title"
          :subtitle="heading.subtitle"
          :today-label="todayLabel"
        />

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

@media (max-width: 860px) {
  .dash {
    flex-direction: column;
  }

  .dash-side {
    width: 100%;
    height: auto;
    position: static;
    overflow: visible;
    border-inline-end: none;
    border-block-end: 1px solid var(--line);
  }

  .dash-main {
    margin-inline-start: 0;
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

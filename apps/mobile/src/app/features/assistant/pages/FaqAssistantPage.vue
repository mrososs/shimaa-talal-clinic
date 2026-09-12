<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { IonIcon } from '@ionic/vue';
import { chatbubblesOutline, searchOutline, warningOutline } from 'ionicons/icons';
import { useRouter } from 'vue-router';
import ScreenShell from '../../../shared/components/ScreenShell.vue';
import FaqTopicList from '../components/FaqTopicList.vue';
import { FAQ_TOPICS } from '../faq.data';

const router = useRouter();
const query = shallowRef('');
const visibleTopics = computed(() => {
  const value = query.value.trim().toLocaleLowerCase('ar');
  if (!value) return FAQ_TOPICS;
  return FAQ_TOPICS.filter((topic) =>
    `${topic.question} ${topic.answer}`.toLocaleLowerCase('ar').includes(value),
  );
});
</script>

<template>
  <screen-shell
    title="مساعد العيادة"
    subtitle="إجابات معتمدة عن استخدام التطبيق"
    :back-to="{ name: 'home' }"
  >
    <div class="assistant-page">
      <section class="card intro">
        <span class="intro__icon"><ion-icon :icon="chatbubblesOutline" /></span>
        <div>
          <strong>كيف يمكنني مساعدتك؟</strong>
          <p>اختاري سؤالاً أو ابحثي. الأسئلة الطبية يجيب عنها فريق العيادة.</p>
        </div>
      </section>

      <label class="search">
        <ion-icon :icon="searchOutline" />
        <input v-model="query" type="search" placeholder="ابحثي في الأسئلة" />
      </label>

      <faq-topic-list :topics="visibleTopics" />

      <section v-if="visibleTopics.length === 0" class="card no-results">
        لا توجد إجابة مطابقة. أرسلي سؤالك مباشرة إلى العيادة.
      </section>

      <section class="card urgent">
        <ion-icon :icon="warningOutline" />
        <div>
          <strong>هل تحتاجين رداً من الفريق؟</strong>
          <p>أرسلي رسالة آمنة وحددي الطفل، أو اطلبي مراجعة عاجلة من داخل المحادثة.</p>
        </div>
        <button type="button" @click="router.push({ name: 'messages' })">
          مراسلة العيادة
        </button>
      </section>
    </div>
  </screen-shell>
</template>

<style scoped>
.assistant-page {
  display: grid;
  gap: 14px;
}
.intro {
  padding: 17px;
  display: flex;
  align-items: center;
  gap: 13px;
  background: linear-gradient(135deg, var(--coral-soft), var(--surface));
}
.intro__icon {
  inline-size: 48px;
  block-size: 48px;
  flex: 0 0 auto;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: var(--coral);
  color: white;
  font-size: 25px;
}
.intro strong,
.urgent strong {
  font: 800 16px var(--ff-display);
}
.intro p,
.urgent p {
  margin: 3px 0 0;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.6;
}
.search {
  min-block-size: 52px;
  padding-inline: 15px;
  border: 1.5px solid var(--line);
  border-radius: var(--r-pill);
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--surface);
  color: var(--muted);
}
.search input {
  min-width: 0;
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font: 700 14px var(--ff-body);
}
.no-results {
  padding: 22px;
  color: var(--ink-2);
  font-weight: 700;
  text-align: center;
}
.urgent {
  padding: 16px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 10px;
  background: #fff7e5;
}
.urgent > ion-icon {
  margin-block-start: 3px;
  color: var(--warn);
  font-size: 24px;
}
.urgent button {
  grid-column: 1 / -1;
  min-block-size: 48px;
  border: none;
  border-radius: var(--r-pill);
  background: var(--coral);
  color: white;
  font: 800 14px var(--ff-body);
  cursor: pointer;
}
</style>

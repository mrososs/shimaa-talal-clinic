<script setup lang="ts">
import { ref, watch, type DeepReadonly } from 'vue';
import { ClinicMemberRole, type ClinicSession, type MessageThreadDetail, type QuickReplyTemplate } from '@clinic/contracts';

const props = defineProps<{
  thread: DeepReadonly<MessageThreadDetail> | null;
  templates: readonly QuickReplyTemplate[];
  sessions: readonly ClinicSession[];
  role: ClinicMemberRole;
  working: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  reply: [body: string];
  assign: [];
  close: [];
  reopen: [];
  urgent: [note: string];
  acceptUrgent: [caseId: string, sessionId: string, note?: string];
  rejectUrgent: [caseId: string, note?: string];
}>();

const draft = ref('');
const triageNote = ref('');
const decisionNote = ref('');
const sessionId = ref('');

const canTriage = () => props.role === ClinicMemberRole.Reception || props.role === ClinicMemberRole.Admin;
const canDecide = () => props.role === ClinicMemberRole.Doctor || props.role === ClinicMemberRole.Admin;

watch(() => props.thread?.id, () => {
  draft.value = '';
  triageNote.value = '';
  decisionNote.value = '';
  sessionId.value = props.sessions.find((session) => session.status === 'open')?.id ?? '';
});

function send(): void {
  const body = draft.value.trim();
  if (!body) return;
  emit('reply', body);
  draft.value = '';
}

function useTemplate(body: string): void {
  draft.value = body;
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
</script>

<template>
  <section
    class="dcard conversation"
    aria-live="polite"
  >
    <div
      v-if="loading"
      class="conversation__empty"
    >
      جارٍ فتح المحادثة…
    </div>
    <div
      v-else-if="!thread"
      class="conversation__empty"
    >
      <strong>اختاري محادثة</strong>
      <span>ستظهر الرسائل والإجراءات هنا.</span>
    </div>
    <template v-else>
      <header class="conversation__head">
        <div>
          <div class="drow">
            <h2>{{ thread.contactName }}</h2>
            <span
              v-if="thread.priority === 'urgent'"
              class="dpill dpill--danger"
            >حالة عاجلة</span>
            <span
              class="dpill"
              :class="thread.status === 'open' ? 'dpill--ok' : ''"
            >{{ thread.status === 'open' ? 'مفتوحة' : 'مغلقة' }}</span>
          </div>
          <p>عن {{ thread.childName }} · {{ thread.subject }}</p>
        </div>
        <div class="conversation__actions">
          <button
            v-if="canTriage()"
            class="dbtn dbtn--soft dbtn--sm"
            type="button"
            :disabled="working"
            @click="emit('assign')"
          >
            تحويل للطبيبة
          </button>
          <button
            v-if="thread.status === 'open'"
            class="dbtn dbtn--ghost dbtn--sm"
            type="button"
            :disabled="working"
            @click="emit('close')"
          >
            إغلاق المحادثة
          </button>
          <button
            v-else
            class="dbtn dbtn--ghost dbtn--sm"
            type="button"
            :disabled="working"
            @click="emit('reopen')"
          >
            إعادة الفتح
          </button>
        </div>
      </header>

      <aside
        v-if="thread.urgentCase"
        class="triage-card"
        :class="`triage-card--${thread.urgentCase.status}`"
      >
        <strong>تقييم عاجل</strong>
        <p>{{ thread.urgentCase.triageNote }}</p>
        <p
          v-if="thread.urgentCase.decisionNote"
          class="dmuted"
        >
          قرار الطبيبة: {{ thread.urgentCase.decisionNote }}
        </p>
        <div
          v-if="thread.urgentCase.status === 'pending' && canDecide()"
          class="triage-decision"
        >
          <label class="dfield">
            <span class="dfield__label">ملاحظة القرار</span>
            <input
              v-model="decisionNote"
              class="dinput"
              placeholder="اختياري"
            >
          </label>
          <label class="dfield">
            <span class="dfield__label">جلسة الطابور المفتوحة</span>
            <select
              v-model="sessionId"
              class="dinput"
            >
              <option value="">اختاري جلسة</option>
              <option
                v-for="session in sessions.filter((item) => item.status === 'open')"
                :key="session.id"
                :value="session.id"
              >{{ session.sessionKind === 'morning' ? 'الفترة الصباحية' : 'الفترة المسائية' }}</option>
            </select>
          </label>
          <div class="drow">
            <button
              class="dbtn dbtn--primary"
              type="button"
              :disabled="working || !sessionId"
              @click="emit('acceptUrgent', thread.urgentCase!.id, sessionId, decisionNote || undefined)"
            >
              قبول وإضافة للطابور كحالة طارئة
            </button>
            <button
              class="dbtn dbtn--ghost"
              type="button"
              :disabled="working"
              @click="emit('rejectUrgent', thread.urgentCase!.id, decisionNote || undefined)"
            >
              لا تحتاج طابورًا عاجلًا
            </button>
          </div>
        </div>
        <p
          v-if="thread.urgentCase.status === 'pending'"
          class="dnotice dnotice--error"
        >
          إذا ظهرت صعوبة تنفس، فقدان وعي، تشنج أو نزيف شديد: وجّهي الأسرة للطوارئ فورًا، ولا تنتظري رد الرسائل.
        </p>
      </aside>

      <div class="messages">
        <article
          v-for="message in thread.messages"
          :key="message.id"
          class="message"
          :class="`message--${message.senderType}`"
        >
          <span class="message__author">{{ message.senderName }}</span>
          <p>{{ message.body }}</p>
          <time>{{ timeLabel(message.createdAt) }}</time>
        </article>
      </div>

      <div
        v-if="thread.status === 'open'"
        class="composer"
      >
        <div
          v-if="templates.length"
          class="quick-replies"
          aria-label="ردود سريعة"
        >
          <button
            v-for="template in templates"
            :key="template.id"
            type="button"
            @click="useTemplate(template.body)"
          >
            {{ template.title }}
          </button>
        </div>
        <textarea
          v-model="draft"
          class="dinput composer__input"
          rows="3"
          placeholder="اكتبي ردًا واضحًا للأسرة…"
        />
        <button
          class="dbtn dbtn--primary"
          type="button"
          :disabled="working || !draft.trim()"
          @click="send"
        >
          إرسال الرد
        </button>
      </div>

      <div
        v-if="canTriage() && !thread.urgentCase && thread.status === 'open'"
        class="urgent-form"
      >
        <label class="dfield">
          <span class="dfield__label">تحويل كتقييم عاجل للطبيبة</span>
          <textarea
            v-model="triageNote"
            class="dinput"
            rows="2"
            placeholder="الأعراض وسبب اعتبار الحالة عاجلة"
          />
        </label>
        <button
          class="dbtn dbtn--ghost"
          type="button"
          :disabled="working || !triageNote.trim()"
          @click="emit('urgent', triageNote)"
        >
          إرسال كتقييم عاجل
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.conversation { min-height: 540px; display: flex; flex-direction: column; overflow: hidden; }
.conversation__empty { min-height: 540px; display: grid; place-content: center; gap: 6px; text-align: center; color: var(--muted); }
.conversation__head { display: flex; justify-content: space-between; gap: 16px; padding: 18px 20px; border-block-end: 1px solid var(--line); }
.conversation__head h2 { font-size: 18px; }
.conversation__head p { margin-top: 5px; color: var(--muted); font-size: 13px; }
.conversation__actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 7px; }
.triage-card { margin: 14px 20px 0; padding: 14px; border-radius: 14px; background: var(--sun-soft); display: grid; gap: 9px; }
.triage-card--accepted { background: var(--teal-soft); }
.triage-card--rejected { background: var(--surface-2); }
.triage-decision { display: grid; gap: 10px; }
.messages { flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 20px; background: color-mix(in srgb, var(--surface-2) 62%, white); }
.message { max-width: 76%; padding: 10px 13px; border-radius: 15px; background: white; box-shadow: var(--sh-sm); }
.message--staff { align-self: flex-end; background: var(--coral-soft); }
.message__author { display: block; margin-bottom: 4px; color: var(--coral-ink); font-size: 11px; font-weight: 800; }
.message p { white-space: pre-wrap; line-height: 1.7; }
.message time { display: block; margin-top: 4px; color: var(--muted); font-size: 10px; }
.composer, .urgent-form { padding: 14px 20px; border-block-start: 1px solid var(--line); display: grid; gap: 10px; }
.composer { grid-template-columns: 1fr auto; align-items: end; }
.composer__input, .quick-replies { grid-column: 1 / -1; }
.quick-replies { display: flex; gap: 6px; overflow-x: auto; }
.quick-replies button { border: 1px solid var(--line); border-radius: 99px; background: white; padding: 6px 10px; font: inherit; font-size: 12px; cursor: pointer; }
@media (max-width: 760px) { .conversation__head { flex-direction: column; } .message { max-width: 92%; } }
</style>

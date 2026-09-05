<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  ClinicMemberRole,
  QueueStatus,
  type AppointmentListItem,
  type DoctorPresence,
  type QueueBoardEntry,
} from '@clinic/contracts';
import { queueApi, session as staffSession } from '../../../runtime';
import { agoLabel } from '../../../shared/format';
import { arabicDigits } from '../../../shared/numerals';
import ReasonDialog from '../../../shared/components/ReasonDialog.vue';
import { useQueueBoard } from '../composables/useQueueBoard';
import ExpectedList from '../components/ExpectedList.vue';
import NowServingPanel from '../components/NowServingPanel.vue';
import QueueList from '../components/QueueList.vue';
import SessionControls from '../components/SessionControls.vue';

/**
 * The screen the clinic day is run from.
 *
 * It composes; it decides nothing. Order, ticket numbers, who may be called and
 * what counts as late all come from the server, and every button here is one
 * request followed by a re-read. Polling is five seconds and pauses the moment
 * the tab is hidden — a board left open on a desk overnight should cost nothing.
 *
 * What a doctor may do is narrower than what reception may, and the API refuses
 * the difference whether or not the button was drawn. Hiding it is a courtesy,
 * not the rule.
 */

const state = staffSession.state;
const board = useQueueBoard();

const clinic = computed(() => state.identity?.clinic ?? null);
const timezone = computed(() => clinic.value?.timezone ?? 'Africa/Cairo');
const role = computed(() => state.identity?.member.role ?? null);

/** Reception's desk decisions: admitting, removing, reordering, skipping. */
const canManage = computed(
  () =>
    role.value === ClinicMemberRole.Reception ||
    role.value === ClinicMemberRole.Admin,
);

const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
const updated = computed(() => agoLabel(board.updatedAt.value, now.value));

onMounted(() => {
  void board.open(clinic.value?.today);
  clock = setInterval(() => {
    now.value = Date.now();
  }, 5_000);
});

onUnmounted(() => {
  if (clock !== null) clearInterval(clock);
});

// --- reasons ----------------------------------------------------------

type Ask =
  | { kind: 'emergency'; entry: QueueBoardEntry }
  | { kind: 'miss'; entry: QueueBoardEntry }
  | { kind: 'remove'; entry: QueueBoardEntry };

const ask = ref<Ask | null>(null);

const askTitle = computed(() => {
  switch (ask.value?.kind) {
    case 'emergency':
      return 'تحويل إلى حالة عاجلة';
    case 'miss':
      return 'تخطّي المريض قبل انتهاء المهلة';
    case 'remove':
      return 'إزالة من الطابور';
    default:
      return '';
  }
});

const askConfirm = computed(() =>
  ask.value?.kind === 'remove' ? 'إزالة' : 'تأكيد',
);

/** Only the emergency reason is mandatory — it is the one nobody may skip. */
const askRequired = computed(() => ask.value?.kind !== 'remove');

function resolveAsk(reason: string): void {
  const pending = ask.value;
  ask.value = null;
  if (pending === null) return;

  const entry = pending.entry;
  switch (pending.kind) {
    case 'emergency':
      void board.run(entry.id, () =>
        queueApi.setEmergency(entry.id, true, reason),
      );
      return;
    case 'miss':
      // `force` is what makes this legal before the grace has run out, and the
      // server records the reason against whoever pressed it.
      void board.run(entry.id, () =>
        queueApi.miss(entry.id, { force: true, reason }),
      );
      return;
    case 'remove':
      void board.run(entry.id, () =>
        queueApi.cancelEntry(entry.id, reason || undefined),
      );
  }
}

// --- commands ---------------------------------------------------------

function callNext(): void {
  const id = board.sessionId.value;
  if (id === null) return;
  void board.run('call-next', () => queueApi.callNext(id));
}

/**
 * "Did not come."
 *
 * Asked for a reason only when the grace period is still running: skipping
 * somebody early is a judgement call, and skipping somebody whose ten minutes
 * have passed is just the queue moving on.
 */
function miss(entry: QueueBoardEntry): void {
  const lapsed =
    entry.graceExpiresAt !== null &&
    Date.parse(entry.graceExpiresAt) <= Date.now();
  if (lapsed) {
    void board.run(entry.id, () => queueApi.miss(entry.id));
    return;
  }
  ask.value = { kind: 'miss', entry };
}

function moveEntry(entry: QueueBoardEntry, direction: -1 | 1): void {
  const line = board.waiting.value;
  const index = line.findIndex((row) => row.id === entry.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= line.length) return;

  // Expressed as neighbours, not as a position: the server takes their
  // midpoint and one row changes, so nobody else is renumbered.
  const between =
    direction === -1
      ? { beforeEntryId: line[target].id }
      : { afterEntryId: line[target].id };
  void board.run(entry.id, () => queueApi.move(entry.id, between));
}

function checkIn(appointment: AppointmentListItem): void {
  void board.run(appointment.id, () => queueApi.checkIn(appointment.id));
}

function sessionCommand(
  key: string,
  command: (id: string) => Promise<unknown>,
): void {
  const id = board.sessionId.value;
  if (id === null) return;
  void board.run(key, () => command(id));
}

function close(): void {
  const waiting = board.waiting.value.length;
  // Closing cancels whoever is still in the line, and those families were told
  // to wait. Naming the number is the least this can do before doing it.
  const message =
    waiting === 0
      ? 'إنهاء اليوم؟ لا يمكن فتحه من جديد.'
      : `ما زال ${arabicDigits(waiting)} في الانتظار. إنهاء اليوم؟`;
  if (!window.confirm(message)) return;
  sessionCommand('close', (id) => queueApi.closeSession(id));
}

function setPresence(presence: DoctorPresence): void {
  sessionCommand('presence', (id) => queueApi.setPresence(id, { presence }));
}
</script>

<template>
  <div class="dstack">
    <p
      v-if="board.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ board.failure.value }}
    </p>

    <div
      v-if="board.loading.value"
      class="dcard dcard--pad centre dmuted"
    >
      جارٍ التحميل…
    </div>

    <div
      v-else-if="board.session.value === null"
      class="dcard dcard--pad centre dmuted"
    >
      لا توجد جلسة عيادة اليوم.
    </div>

    <template v-else>
      <SessionControls
        :session="board.session.value"
        :sessions="board.sessions.value"
        :timezone="timezone"
        :working="board.working.value"
        @select="board.select"
        @open="sessionCommand('open', (id) => queueApi.openSession(id))"
        @pause="sessionCommand('pause', (id) => queueApi.pauseSession(id))"
        @resume="sessionCommand('resume', (id) => queueApi.resumeSession(id))"
        @close="close"
        @presence="setPresence"
        @pace="
          (minutes) =>
            sessionCommand('pace', (id) => queueApi.setPace(id, minutes))
        "
      />

      <NowServingPanel
        :in-service="board.inService.value"
        :called="board.called.value"
        :waiting-count="board.waiting.value.length"
        :running="board.running.value"
        :working="board.working.value"
        :can-miss="canManage"
        @call-next="callNext"
        @start="(id) => board.run(id, () => queueApi.start(id))"
        @complete="(id) => board.run(id, () => queueApi.complete(id))"
        @miss="miss"
      />

      <div class="lists">
        <QueueList
          :entries="board.waiting.value"
          :can-manage="canManage"
          :working="board.working.value"
          @call="(entry) => board.run(entry.id, () => queueApi.call(entry.id))"
          @emergency="(entry) => (ask = { kind: 'emergency', entry })"
          @clear-emergency="
            (entry) =>
              board.run(entry.id, () => queueApi.setEmergency(entry.id, false))
          "
          @remove="(entry) => (ask = { kind: 'remove', entry })"
          @move="moveEntry"
        />

        <ExpectedList
          :items="board.notArrived.value"
          :timezone="timezone"
          :can-check-in="canManage"
          :working="board.working.value"
          @check-in="checkIn"
        />
      </div>

      <!-- Finished, missed and removed. Kept visible so the desk can see what
           happened, and so a missed patient can be put back. -->
      <section
        v-if="board.settled.value.length > 0"
        class="dcard"
      >
        <header class="dcard__head">
          <h2 class="dcard__title">
            انتهى اليوم بالنسبة لهم
          </h2>
          <span class="dpill">
            {{ arabicDigits(board.settled.value.length) }}
          </span>
        </header>
        <div class="dtable">
          <div
            v-for="entry in board.settled.value"
            :key="entry.id"
            class="dtable__row settled"
          >
            <span class="settled__ticket">
              {{ arabicDigits(entry.ticketNumber) }}
            </span>
            <strong>{{ entry.child.fullName }}</strong>
            <span
              class="dpill"
              :class="{
                'dpill--ok': entry.status === QueueStatus.Done,
                'dpill--warn': entry.status === QueueStatus.Missed,
              }"
            >
              {{
                entry.status === QueueStatus.Done
                  ? 'تمت'
                  : entry.status === QueueStatus.Missed
                    ? 'لم يحضر'
                    : 'أُزيل'
              }}
            </span>
            <button
              v-if="canManage && entry.status === QueueStatus.Missed"
              class="dbtn dbtn--ghost dbtn--sm"
              :disabled="board.working.value !== null"
              @click="board.run(entry.id, () => queueApi.requeue(entry.id))"
            >
              إعادة للطابور
            </button>
            <span v-else />
          </div>
        </div>
      </section>

      <p
        v-if="updated"
        class="dmuted stamp"
      >
        آخر تحديث {{ updated }}
        <template v-if="!board.polling.active.value">
          · متوقف
        </template>
      </p>
    </template>

    <ReasonDialog
      :open="ask !== null"
      :title="askTitle"
      :subject="ask?.entry.child.fullName"
      :confirm-label="askConfirm"
      :required="askRequired"
      placeholder="سبب مختصر يظهر في سجل العيادة"
      @confirm="resolveAsk"
      @cancel="ask = null"
    />
  </div>
</template>

<style scoped>
.centre {
  text-align: center;
}

.lists {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 18px;
  align-items: start;
  min-width: 0;
}

.lists > * {
  min-width: 0;
}

.settled {
  grid-template-columns: 62px 1fr 90px auto;
  align-items: center;
}

.settled__ticket {
  font-family: var(--ff-display);
  font-weight: 800;
  text-align: center;
  color: var(--ink-2);
}

.stamp {
  margin: 0;
  text-align: center;
  font-size: 12.5px;
}

@media (max-width: 1100px) {
  .lists {
    grid-template-columns: 1fr;
  }
}
</style>

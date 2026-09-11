<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import {
  ClinicMemberRole,
  QueueStatus,
  type AppointmentListItem,
  type CreateClinicalMeasurementInput,
  type DoctorPresence,
  type QueueBoardEntry,
} from '@clinic/contracts';
import {
  clinicApi,
  config,
  queueApi,
  session as staffSession,
} from '../../../runtime';
import { agoLabel } from '../../../shared/format';
import { arabicDigits } from '../../../shared/numerals';
import ConfirmDialog from '../../../shared/components/ConfirmDialog.vue';
import ReasonDialog from '../../../shared/components/ReasonDialog.vue';
import { useQueueBoard } from '../composables/useQueueBoard';
import ExpectedList from '../components/ExpectedList.vue';
import NowServingPanel from '../components/NowServingPanel.vue';
import QueueList from '../components/QueueList.vue';
import SessionControls from '../components/SessionControls.vue';
import WalkInDialog from '../components/WalkInDialog.vue';
import RecordMeasurementDialog from '../../clinical/components/RecordMeasurementDialog.vue';
import type { WalkInInput } from '../queue.api';

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
const linkNotice = shallowRef<string | null>(null);

const clinic = computed(() => state.identity?.clinic ?? null);
const timezone = computed(() => clinic.value?.timezone ?? 'Africa/Cairo');
const role = computed(() => state.identity?.member.role ?? null);

/** Reception's desk decisions: admitting, removing, reordering, skipping. */
const canManage = computed(
  () =>
    role.value === ClinicMemberRole.Reception ||
    role.value === ClinicMemberRole.Admin,
);

const canComplete = computed(
  () =>
    role.value === ClinicMemberRole.Reception ||
    role.value === ClinicMemberRole.Admin ||
    role.value === ClinicMemberRole.Doctor,
);
const isDoctor = computed(() => role.value === ClinicMemberRole.Doctor);
const canOpenClinical = computed(
  () =>
    role.value === ClinicMemberRole.Doctor ||
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

async function copyGuestLink(entry: QueueBoardEntry): Promise<void> {
  linkNotice.value = null;
  await board.run(`guest-link-${entry.id}`, async () => {
    const link = await queueApi.createGuestLink(entry.id);
    const url = new URL(`/queue/guest/${link.token}`, config.mobileAppUrl);
    await navigator.clipboard.writeText(url.toString());
    linkNotice.value = 'تم نسخ رابط متابعة الدور. الرابط لا يعرض اسم المريض.';
  });
}

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

function completeAndCallNext(): void {
  const id = board.sessionId.value;
  if (id === null) return;
  void board.run('complete-and-call-next', () =>
    queueApi.completeAndCallNext(id),
  );
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

/**
 * Ending the day is final, and it cancels whoever is still in the line.
 *
 * Those families were told to wait, so the question names how many there are
 * before it is answered — and it is asked in a dialog the clinic can read,
 * rather than the browser's own, which renders "OK / Cancel" in English and
 * left-to-right over an Arabic screen.
 */
const closing = ref(false);
const addingWalkIn = ref(false);
const measuringEntry = ref<QueueBoardEntry | null>(null);

const closeMessage = computed(() => {
  const waiting = board.waiting.value.length;
  return waiting === 0
    ? 'سيُغلق يوم العيادة ولا يمكن فتحه من جديد.'
    : `ما زال ${arabicDigits(waiting)} في الانتظار — سيُلغى دورهم، ولا يمكن فتح اليوم من جديد.`;
});

function confirmClose(): void {
  closing.value = false;
  sessionCommand('close', (id) => queueApi.closeSession(id));
}

function setPresence(presence: DoctorPresence): void {
  sessionCommand('presence', (id) => queueApi.setPresence(id, { presence }));
}

function admitWalkIn(input: WalkInInput): void {
  const sessionId = board.sessionId.value;
  if (sessionId === null) return;
  void board
    .run('walk-in', () => queueApi.walkIn({ sessionId, ...input }))
    .then(() => {
      if (board.failure.value === null) addingWalkIn.value = false;
    });
}

async function recordMeasurements(
  input: CreateClinicalMeasurementInput,
): Promise<void> {
  const entry = measuringEntry.value;
  if (entry === null) return;
  await board.run(`measurements-${entry.id}`, () =>
    clinicApi.addMeasurement(entry.childId, {
      ...input,
      appointmentId: entry.appointmentId,
    }),
  );
  if (board.failure.value === null) measuringEntry.value = null;
}
</script>

<template>
  <div class="dstack">
    <p v-if="board.failure.value" class="dnotice dnotice--error" role="alert">
      {{ board.failure.value }}
    </p>

    <p v-if="linkNotice" class="dnotice dnotice--ok" role="status">
      {{ linkNotice }}
    </p>

    <div v-if="board.loading.value" class="dcard dcard--pad centre dmuted">
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
        :operational="!isDoctor"
        @select="board.select"
        @open="sessionCommand('open', (id) => queueApi.openSession(id))"
        @pause="sessionCommand('pause', (id) => queueApi.pauseSession(id))"
        @resume="sessionCommand('resume', (id) => queueApi.resumeSession(id))"
        @close="closing = true"
        @presence="setPresence"
        @pace="
          (minutes) =>
            sessionCommand('pace', (id) => queueApi.setPace(id, minutes))
        "
      />

      <div v-if="canManage" class="queue-tools">
        <button
          class="dbtn dbtn--primary"
          type="button"
          :disabled="!board.running.value || board.working.value !== null"
          @click="addingWalkIn = true"
        >
          تسجيل مريض بدون موعد
        </button>
      </div>

      <NowServingPanel
        :in-service="board.inService.value"
        :called="board.called.value"
        :waiting-count="board.waiting.value.length"
        :running="board.running.value"
        :working="board.working.value"
        :can-miss="canManage"
        :can-complete="canComplete"
        :can-open-clinical="canOpenClinical"
        :can-record-measurements="canComplete"
        @call-next="callNext"
        @complete-and-call-next="completeAndCallNext"
        @start="(id) => board.run(id, () => queueApi.start(id))"
        @complete="(id) => board.run(id, () => queueApi.complete(id))"
        @miss="miss"
        @record-measurements="(entry) => (measuringEntry = entry)"
      />

      <div class="lists">
        <QueueList
          :entries="
            isDoctor ? board.waiting.value.slice(0, 4) : board.waiting.value
          "
          :can-manage="canManage"
          :can-call="!isDoctor"
          :working="board.working.value"
          :can-record-measurements="canComplete"
          @call="(entry) => board.run(entry.id, () => queueApi.call(entry.id))"
          @emergency="(entry) => (ask = { kind: 'emergency', entry })"
          @clear-emergency="
            (entry) =>
              board.run(entry.id, () => queueApi.setEmergency(entry.id, false))
          "
          @remove="(entry) => (ask = { kind: 'remove', entry })"
          @move="moveEntry"
          @record-measurements="(entry) => (measuringEntry = entry)"
          @share="copyGuestLink"
        />

        <ExpectedList
          v-if="!isDoctor"
          :items="board.notArrived.value"
          :timezone="timezone"
          :can-check-in="canManage"
          :working="board.working.value"
          @check-in="checkIn"
        />
      </div>

      <!-- Finished, missed and removed. Kept visible so the desk can see what
           happened, and so a missed patient can be put back. -->
      <section v-if="!isDoctor && board.settled.value.length > 0" class="dcard">
        <header class="dcard__head">
          <h2 class="dcard__title">انتهى اليوم بالنسبة لهم</h2>
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

      <p v-if="updated" class="dmuted stamp">
        آخر تحديث {{ updated }}
        <template v-if="!board.polling.active.value"> · متوقف </template>
      </p>
    </template>

    <ConfirmDialog
      :open="closing"
      title="إنهاء اليوم"
      :message="closeMessage"
      confirm-label="إنهاء اليوم"
      destructive
      @confirm="confirmClose"
      @cancel="closing = false"
    />

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

    <WalkInDialog
      :open="addingWalkIn"
      :working="board.working.value === 'walk-in'"
      @close="addingWalkIn = false"
      @submit="admitWalkIn"
    />

    <RecordMeasurementDialog
      :open="measuringEntry !== null"
      :child-name="measuringEntry?.child.fullName"
      :working="
        measuringEntry !== null &&
        board.working.value === `measurements-${measuringEntry.id}`
      "
      @close="measuringEntry = null"
      @submit="recordMeasurements"
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

.queue-tools {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 1100px) {
  .lists {
    grid-template-columns: 1fr;
  }
}
</style>

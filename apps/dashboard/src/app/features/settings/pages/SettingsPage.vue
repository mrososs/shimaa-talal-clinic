<script setup lang="ts">
import { onMounted, reactive, ref, shallowRef } from 'vue';
import type { ClinicAuditEvent, ClinicSettings } from '@clinic/contracts';
import { settingsApi } from '../../../runtime';
import { apiMessage } from '../../../shared/messages';
type Tab = 'clinic' | 'tracking' | 'schedule' | 'notifications' | 'team' | 'audit';
const tab = ref<Tab>('clinic'),
  data = shallowRef<ClinicSettings | null>(null),
  audit = shallowRef<ClinicAuditEvent[]>([]),
  loading = ref(true),
  working = ref(false),
  failure = ref<string | null>(null);
const profile = reactive({
    name: '',
    phoneE164: '',
    address: '',
    instapayHandle: '',
  }),
  policies = reactive({
    gracePeriodMinutes: 10,
    defaultAvgConsultMinutes: 6,
    maxSelfDefers: 2,
    minLeadMinutes: 0,
    cancellationCutoffMinutes: 120,
    autoConfirmParentBookings: false,
  }),
  tracking = reactive({
    estimatorEnabled: false,
    receptionVisible: false,
    parentVisible: false,
    guestEnabled: false,
    attendanceEnabled: false,
    fairnessEnabled: false,
    arrivalBufferMinutes: 15,
    earlyCheckInMinutes: 30,
    minimumTravelLeadMinutes: 30,
    publicationThresholdMinutes: 10,
    maxEarlierShiftMinutes: 15,
    configuredBaselineMinutes: null as number | null,
    validateBaseline: false,
    approveParentEstimate: false,
  });
const schedule = reactive({
    doctorMemberId: '',
    weekday: 0,
    sessionKind: 'morning',
    startsAt: '10:00',
    endsAt: '16:00',
    windowMinutes: 60,
    capacityPerWindow: 5,
    effectiveFrom: '',
  }),
  closure = reactive({ startsAt: '', endsAt: '', reason: '' });
const tabs: [Tab, string][] = [
  ['clinic', 'العيادة والسياسات'],
  ['tracking', 'تقدير الحضور'],
  ['schedule', 'الجداول والإجازات'],
  ['notifications', 'الإشعارات'],
  ['team', 'الفريق والصلاحيات'],
  ['audit', 'سجل التدقيق'],
];
const visitLabels: Record<string, string> = {
  new_visit: 'كشف جديد',
  follow_up: 'متابعة',
  vaccination: 'تطعيم',
  consultation: 'استشارة',
  newborn: 'حديث الولادة',
};
function sync(v: ClinicSettings) {
  data.value = v;
  Object.assign(profile, {
    name: v.profile.name,
    phoneE164: v.profile.phoneE164 ?? '',
    address: v.profile.address ?? '',
    instapayHandle: v.profile.instapayHandle ?? '',
  });
  Object.assign(policies, v.policies);
  Object.assign(tracking, v.tracking, {
    validateBaseline: false,
    approveParentEstimate: false,
  });
  schedule.doctorMemberId = v.team.find((m) => m.role === 'doctor')?.id ?? '';
}
async function load() {
  loading.value = true;
  try {
    sync(await settingsApi.read());
    failure.value = null;
  } catch (e) {
    failure.value = apiMessage(e);
  } finally {
    loading.value = false;
  }
}
async function run(work: () => Promise<ClinicSettings>) {
  working.value = true;
  try {
    sync(await work());
    failure.value = null;
  } catch (e) {
    failure.value = apiMessage(e);
  } finally {
    working.value = false;
  }
}
async function open(next: Tab) {
  tab.value = next;
  if (next === 'audit')
    try {
      audit.value = await settingsApi.audit();
    } catch (e) {
      failure.value = apiMessage(e);
    }
}
function saveClosure() {
  return settingsApi.closure({
    startsAt: new Date(closure.startsAt).toISOString(),
    endsAt: new Date(closure.endsAt).toISOString(),
    reason: closure.reason,
  });
}
onMounted(load);
</script>
<template>
  <div class="dstack">
    <nav class="dtabs" aria-label="أقسام الإعدادات">
      <button
        v-for="item in tabs"
        :key="item[0]"
        :class="{ active: tab === item[0] }"
        @click="open(item[0])"
      >
        {{ item[1] }}
      </button>
    </nav>
    <p v-if="failure" class="dnotice dnotice--error" role="alert">
      {{ failure }}
    </p>
    <div v-if="loading" class="dcard dcard--pad">جارٍ تحميل الإعدادات…</div>
    <template v-else-if="data">
      <section v-if="tab === 'clinic'" class="settings-grid">
        <form
          class="dcard dcard--pad dstack"
          @submit.prevent="run(() => settingsApi.profile(profile))"
        >
          <h2>بيانات العيادة</h2>
          <label>اسم العيادة<input v-model="profile.name" required /></label
          ><label>الهاتف<input v-model="profile.phoneE164" dir="ltr" /></label
          ><label>العنوان<textarea v-model="profile.address" rows="3" /></label
          ><label
            >عنوان InstaPay<input
              v-model="profile.instapayHandle"
              dir="ltr"
              maxlength="200"
              placeholder="clinic@instapay" /></label
          ><button class="dbtn dbtn--primary" :disabled="working">
            حفظ البيانات
          </button>
        </form>
        <form
          class="dcard dcard--pad dstack"
          @submit.prevent="run(() => settingsApi.policies(policies))"
        >
          <h2>سياسات التشغيل</h2>
          <label
            >مهلة النداء بالدقائق<input
              v-model.number="policies.gracePeriodMinutes"
              type="number"
              min="1"
              max="120" /></label
          ><label
            >متوسط الكشف<input
              v-model.number="policies.defaultAvgConsultMinutes"
              type="number"
              min="1" /></label
          ><label
            >أقصى مرات التأجيل<input
              v-model.number="policies.maxSelfDefers"
              type="number"
              min="0"
              max="10" /></label
          ><label
            >مهلة الإلغاء<input
              v-model.number="policies.cancellationCutoffMinutes"
              type="number"
              min="0" /></label
          ><label class="check"
            ><input
              v-model="policies.autoConfirmParentBookings"
              type="checkbox"
            />اعتماد حجوزات الأسر تلقائيًا</label
          ><button class="dbtn dbtn--primary" :disabled="working">
            حفظ السياسات
          </button>
        </form>
        <article class="dcard dcard--pad dstack settings-wide">
          <h2>أسعار الخدمات</h2>
          <div
            v-for="price in data.prices"
            :key="price.visitType"
            class="setting-row"
          >
            <strong>{{
              visitLabels[price.visitType] ?? price.visitType
            }}</strong
            ><input
              :value="price.amountMinor / 100"
              type="number"
              min="0"
              step="0.01"
              aria-label="السعر بالجنيه"
              @input="
                price.amountMinor = Math.round(
                  Number(($event.target as HTMLInputElement).value) * 100,
                )
              "
            /><label class="check"
              ><input v-model="price.active" type="checkbox" />مفعّل</label
            ><button
              class="dbtn dbtn--ghost"
              :disabled="working"
              @click="
                run(() =>
                  settingsApi.price(price.visitType, {
                    amountMinor: price.amountMinor,
                    active: price.active,
                  }),
                )
              "
            >
              حفظ
            </button>
          </div>
        </article>
      </section>
      <section v-else-if="tab === 'schedule'" class="settings-grid">
        <form
          class="dcard dcard--pad dstack"
          @submit.prevent="run(() => settingsApi.schedule(schedule))"
        >
          <h2>نسخة جدول جديدة</h2>
          <label
            >الطبيب<select v-model="schedule.doctorMemberId">
              <option
                v-for="m in data.team.filter(
                  (v) => v.role === 'doctor' && v.status === 'active',
                )"
                :key="m.id"
                :value="m.id"
              >
                {{ m.displayName }}
              </option>
            </select></label
          ><label
            >اليوم<input
              v-model.number="schedule.weekday"
              type="number"
              min="0"
              max="6" /></label
          ><label
            >الفترة<select v-model="schedule.sessionKind">
              <option value="morning">صباحية</option>
              <option value="evening">مسائية</option>
            </select></label
          ><label>يبدأ<input v-model="schedule.startsAt" type="time" /></label
          ><label>ينتهي<input v-model="schedule.endsAt" type="time" /></label
          ><label
            >من تاريخ<input
              v-model="schedule.effectiveFrom"
              type="date"
              required /></label
          ><label
            >السعة<input
              v-model.number="schedule.capacityPerWindow"
              type="number"
              min="1" /></label
          ><button class="dbtn dbtn--primary" :disabled="working">
            إضافة نسخة مستقبلية
          </button>
        </form>
        <form
          class="dcard dcard--pad dstack"
          @submit.prevent="run(saveClosure)"
        >
          <h2>إضافة إجازة/إغلاق</h2>
          <label
            >من<input
              v-model="closure.startsAt"
              type="datetime-local"
              required /></label
          ><label
            >إلى<input
              v-model="closure.endsAt"
              type="datetime-local"
              required /></label
          ><label>السبب<input v-model="closure.reason" required /></label
          ><button class="dbtn dbtn--primary" :disabled="working">
            حفظ الإغلاق
          </button>
        </form>
        <article class="dcard dcard--pad settings-wide">
          <h2>الجداول الحالية</h2>
          <div v-for="s in data.schedules" :key="s.id" class="setting-row">
            <span
              >اليوم {{ s.weekday }} · {{ s.startsAt.slice(0, 5) }}–{{
                s.endsAt.slice(0, 5)
              }}</span
            ><span>{{ s.capacityPerWindow }} / نافذة</span
            ><small
              >{{ s.effectiveFrom }}
              {{ s.effectiveTo ? `— ${s.effectiveTo}` : '— مستمر' }}</small
            >
          </div>
        </article>
      </section>
      <section v-else-if="tab === 'tracking'" class="settings-grid">
        <form
          class="dcard dcard--pad dstack settings-wide"
          @submit.prevent="run(() => settingsApi.tracking(tracking))"
        >
          <h2>التقدير التجريبي ووقت الحضور</h2>
          <p class="dmuted">
            ابدئي بوضع الظل والاستقبال فقط. عرض التقدير للأسرة محمي من الخادم
            ولا يعمل قبل اعتماد خط الأساس وبوابة التجربة.
          </p>
          <div class="tracking-flags">
            <label class="check"><input v-model="tracking.estimatorEnabled" type="checkbox" />تشغيل المحرك في وضع الظل</label>
            <label class="check"><input v-model="tracking.receptionVisible" type="checkbox" />إظهار التشخيص للاستقبال</label>
            <label class="check"><input v-model="tracking.parentVisible" type="checkbox" />إظهار التقدير للأسرة</label>
            <label class="check"><input v-model="tracking.guestEnabled" type="checkbox" />روابط متابعة الضيوف</label>
            <label class="check"><input v-model="tracking.attendanceEnabled" type="checkbox" />تفعيل قادم/غير قادم</label>
            <label class="check"><input v-model="tracking.fairnessEnabled" type="checkbox" />تطبيق قواعد الوصول العادل</label>
          </div>
          <div class="tracking-values">
            <label>خط الأساس بالدقائق<input v-model.number="tracking.configuredBaselineMinutes" type="number" min="2" max="120" /></label>
            <label>هامش الوصول<input v-model.number="tracking.arrivalBufferMinutes" type="number" min="0" max="120" /></label>
            <label>السماح بالحضور المبكر<input v-model.number="tracking.earlyCheckInMinutes" type="number" min="0" max="240" /></label>
            <label>مهلة السفر<input v-model.number="tracking.minimumTravelLeadMinutes" type="number" min="0" max="240" /></label>
            <label>حد النشر<input v-model.number="tracking.publicationThresholdMinutes" type="number" min="1" max="120" /></label>
            <label>أقصى تقديم للنشر<input v-model.number="tracking.maxEarlierShiftMinutes" type="number" min="1" max="120" /></label>
          </div>
          <label class="check"><input v-model="tracking.validateBaseline" type="checkbox" />اعتماد خط الأساس الحالي</label>
          <label class="check"><input v-model="tracking.approveParentEstimate" type="checkbox" />تسجيل اجتياز بوابة الظل</label>
          <p v-if="data.tracking.baselineValidatedAt" class="dnotice">تم اعتماد خط الأساس.</p>
          <p v-if="data.tracking.parentEstimateApprovedAt" class="dnotice">تم تسجيل اعتماد عرض الأسرة.</p>
          <button class="dbtn dbtn--primary" :disabled="working">حفظ إعدادات التقدير</button>
        </form>
      </section>
      <section
        v-else-if="tab === 'notifications'"
        class="dcard dcard--pad dstack"
      >
        <div v-for="item in data.templates" :key="item.key" class="template">
          <strong>{{ item.key }}</strong
          ><textarea v-model="item.body" rows="3" /><label class="check"
            ><input v-model="item.active" type="checkbox" />مفعّل</label
          ><button
            class="dbtn dbtn--ghost"
            :disabled="working"
            @click="
              run(() =>
                settingsApi.template(item.key, {
                  body: item.body,
                  active: item.active,
                }),
              )
            "
          >
            حفظ القالب
          </button>
        </div>
      </section>
      <section v-else-if="tab === 'team'" class="dcard">
        <div
          v-for="member in data.team"
          :key="member.id"
          class="setting-row team"
        >
          <input v-model="member.displayName" /><select v-model="member.role">
            <option value="doctor">طبيب</option>
            <option value="reception">مساعدة</option>
            <option value="admin">Admin</option></select
          ><select v-model="member.status">
            <option value="active">نشط</option>
            <option value="suspended">موقوف</option></select
          ><button
            class="dbtn dbtn--ghost"
            :disabled="working"
            @click="
              run(() =>
                settingsApi.team(member.id, {
                  displayName: member.displayName,
                  role: member.role,
                  status: member.status,
                }),
              )
            "
          >
            حفظ
          </button>
        </div>
      </section>
      <section v-else class="dcard">
        <div v-if="!audit.length" class="dempty">
          لا توجد تغييرات مسجلة بعد.
        </div>
        <div v-for="event in audit" :key="event.id" class="setting-row">
          <strong>{{ event.actorName }}</strong
          ><span>{{ event.action }}</span
          ><time>{{ new Date(event.createdAt).toLocaleString('ar-EG') }}</time>
        </div>
      </section>
    </template>
  </div>
</template>
<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.settings-wide {
  grid-column: 1/-1;
}
.dstack label,
.template {
  display: grid;
  gap: 6px;
  font-weight: 700;
}
.tracking-flags,
.tracking-values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.dstack input,
.dstack select,
.dstack textarea {
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  font: inherit;
}
.check {
  display: flex !important;
  align-items: center;
  gap: 8px;
}
.setting-row {
  display: grid;
  grid-template-columns: 1fr 140px 120px auto;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.template {
  padding: 15px;
  border-bottom: 1px solid var(--line);
}
@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .setting-row {
    grid-template-columns: 1fr;
  }
  .settings-wide {
    grid-column: auto;
  }
}
</style>

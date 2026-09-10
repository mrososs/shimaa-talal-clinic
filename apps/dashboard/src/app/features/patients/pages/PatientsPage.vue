<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { ClinicMemberRole, type IssuedClaimCode } from '@clinic/contracts';
import { apiMessage } from '../../../shared/messages';
import { clinicApi, session } from '../../../runtime';
import AddChildDialog, {
  type AddChildInput,
} from '../components/AddChildDialog.vue';
import ClaimCodeDialog from '../components/ClaimCodeDialog.vue';
import FamilyDirectoryList from '../components/FamilyDirectoryList.vue';
import FamilyRecordPanel from '../components/FamilyRecordPanel.vue';
import PatientFilesPanel from '../components/PatientFilesPanel.vue';
import UploadPatientFileDialog from '../components/UploadPatientFileDialog.vue';
import { useFamilyDirectory } from '../composables/useFamilyDirectory';
import { usePatientFiles } from '../composables/usePatientFiles';

const directory = useFamilyDirectory();
const patientFiles = usePatientFiles(clinicApi);
const role = computed(() => session.state.identity?.member.role ?? null);
const timezone = computed(
  () => session.state.identity?.clinic.timezone ?? 'Africa/Cairo',
);
const canManage = computed(
  () =>
    role.value === ClinicMemberRole.Reception ||
    role.value === ClinicMemberRole.Admin,
);
const canViewFiles = computed(
  () =>
    role.value === ClinicMemberRole.Doctor ||
    role.value === ClinicMemberRole.Admin,
);
const selectedChildId = shallowRef<string | null>(null);
const selectedChild = computed(
  () =>
    directory.selected.value?.children.find(
      (child) => child.id === selectedChildId.value,
    ) ?? null,
);

const addingChild = ref(false);
const uploadingFile = shallowRef(false);
const working = ref(false);
const actionFailure = ref<string | null>(null);
const claim = shallowRef<IssuedClaimCode | null>(null);

onMounted(() => void directory.search());

watch(
  () => directory.selected.value,
  (record) => {
    selectedChildId.value = record?.children[0]?.id ?? null;
  },
);

watch([selectedChildId, canViewFiles], ([childId, allowed]) => {
  if (allowed && childId !== null) void patientFiles.load(childId);
  else patientFiles.clear();
});

async function addChild(input: AddChildInput): Promise<void> {
  const guardianId = directory.selectedId.value;
  if (guardianId === null || working.value) return;
  working.value = true;
  actionFailure.value = null;
  try {
    await clinicApi.createChild(guardianId, input);
    await directory.refreshSelected();
    addingChild.value = false;
  } catch (error) {
    actionFailure.value = apiMessage(error);
  } finally {
    working.value = false;
  }
}

async function issueClaim(): Promise<void> {
  const guardianId = directory.selectedId.value;
  if (guardianId === null || working.value) return;
  working.value = true;
  actionFailure.value = null;
  try {
    claim.value = await clinicApi.issueClaimCode(guardianId);
  } catch (error) {
    actionFailure.value = apiMessage(error);
  } finally {
    working.value = false;
  }
}

async function uploadPatientFile(file: File): Promise<void> {
  const childId = selectedChildId.value;
  if (childId === null) return;
  if (await patientFiles.upload(childId, file)) uploadingFile.value = false;
}

async function downloadPatientFile(fileId: string): Promise<void> {
  const childId = selectedChildId.value;
  if (childId === null) return;
  const url = await patientFiles.download(childId, fileId);
  if (url !== null) window.open(url, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <div class="dstack">
    <form
      class="dcard dcard--pad patients-search"
      @submit.prevent="directory.search"
    >
      <label class="dfield patients-search__field">
        <span class="dfield__label">ابحثي في ملفات العائلات</span>
        <input
          v-model="directory.query.value"
          class="dinput"
          type="search"
          placeholder="اسم ولي الأمر أو رقم الهاتف"
        >
      </label>
      <button
        class="dbtn dbtn--teal"
        type="submit"
        :disabled="directory.loading.value"
      >
        {{ directory.loading.value ? 'جارٍ البحث…' : 'بحث' }}
      </button>
      <RouterLink
        v-if="canManage"
        class="dbtn dbtn--primary"
        :to="{ name: 'reception-booking' }"
      >
        عائلة أو حجز جديد
      </RouterLink>
    </form>

    <p
      v-if="directory.failure.value || actionFailure"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ actionFailure ?? directory.failure.value }}
    </p>

    <div class="patients-layout">
      <FamilyDirectoryList
        :families="directory.families.value"
        :selected-id="directory.selectedId.value"
        :loading="directory.loading.value"
        :loading-more="directory.loadingMore.value"
        :has-more="directory.hasMore.value"
        @select="directory.open"
        @more="directory.loadMore"
      />
      <div class="patients-detail">
        <FamilyRecordPanel
          :record="directory.selected.value"
          :loading="directory.loadingRecord.value"
          :timezone="timezone"
          :can-manage="canManage"
          :selected-child-id="selectedChildId"
          @add-child="addingChild = true"
          @issue-claim="issueClaim"
          @select-child="selectedChildId = $event"
        />
        <PatientFilesPanel
          v-if="canViewFiles && selectedChild"
          :child-name="selectedChild.fullName"
          :files="patientFiles.files.value"
          :loading="patientFiles.loading.value"
          :uploading="patientFiles.uploading.value"
          @upload="uploadingFile = true"
          @download="downloadPatientFile"
        />
        <RouterLink
          v-if="canViewFiles && selectedChild"
          class="dcard dcard--pad growth-link"
          :to="{
            name: 'growth',
            params: { childId: selectedChild.id },
            query: { childName: selectedChild.fullName },
          }"
        >
          <span>
            <strong>متابعة النمو</strong>
            <small class="dmuted">الوزن والطول ومحيط الرأس وسجل القياسات</small>
          </span>
          <span aria-hidden="true">←</span>
        </RouterLink>
      </div>
    </div>

    <AddChildDialog
      :open="addingChild"
      :family-name="directory.selected.value?.guardian.fullName"
      :working="working"
      @close="addingChild = false"
      @submit="addChild"
    />
    <ClaimCodeDialog
      :open="claim !== null"
      :family-name="directory.selected.value?.guardian.fullName"
      :claim="claim"
      @close="claim = null"
    />
    <UploadPatientFileDialog
      :open="uploadingFile"
      :child-name="selectedChild?.fullName"
      :working="patientFiles.uploading.value"
      @close="uploadingFile = false"
      @submit="uploadPatientFile"
    />
    <p
      v-if="patientFiles.failure.value"
      class="dnotice dnotice--error"
      role="alert"
    >
      {{ patientFiles.failure.value }}
    </p>
  </div>
</template>

<style scoped>
.patients-search {
  display: flex;
  align-items: end;
  gap: 10px;
}
.patients-search__field {
  flex: 1;
}
.patients-layout {
  display: grid;
  grid-template-columns: minmax(280px, 0.7fr) minmax(0, 1.6fr);
  gap: 18px;
  align-items: start;
}
.patients-detail {
  display: grid;
  gap: 18px;
}
.growth-link {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: inherit;
  text-decoration: none;
}
.growth-link span:first-child {
  display: grid;
  gap: 3px;
}
@media (max-width: 900px) {
  .patients-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 620px) {
  .patients-search {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

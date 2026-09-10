import type { DatabaseService, SupabaseService } from '@clinic/server-core';
import type { ChildService } from './child.service';
import { PatientFileService } from './patient-file.service';
import { PatientsErrorCode } from './patients.errors';

const CLINIC_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

function setup() {
  const query = jest.fn();
  const upload = jest
    .fn()
    .mockResolvedValue({ data: { path: 'stored' }, error: null });
  const remove = jest.fn().mockResolvedValue({ data: [], error: null });
  const createSignedUrl = jest.fn().mockResolvedValue({
    data: { signedUrl: 'https://storage.example.test/signed' },
    error: null,
  });
  const from = jest.fn(() => ({ upload, remove, createSignedUrl }));
  const findById = jest
    .fn()
    .mockResolvedValue({ id: CHILD_ID, clinicId: CLINIC_ID });
  const service = new PatientFileService(
    { query } as unknown as DatabaseService,
    { admin: { storage: { from } } } as unknown as SupabaseService,
    { findById } as unknown as ChildService,
  );
  return { service, query, upload, remove, createSignedUrl, findById };
}

function row() {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    child_id: CHILD_ID,
    object_path: `${CLINIC_ID}/${CHILD_ID}/scan.pdf`,
    file_name: 'scan.pdf',
    mime_type: 'application/pdf',
    size_bytes: 4,
    uploaded_by_member_id: MEMBER_ID,
    created_at: new Date('2026-09-08T12:00:00.000Z'),
  };
}

describe('PatientFileService', () => {
  it('rejects an invalid upload before writing metadata or Storage', async () => {
    const { service, query, upload } = setup();

    await expect(
      service.upload({
        clinicId: CLINIC_ID,
        childId: CHILD_ID,
        memberId: MEMBER_ID,
        file: {
          originalname: 'malware.exe',
          mimetype: 'application/octet-stream',
          size: 4,
          buffer: Buffer.from('nope'),
        },
      }),
    ).rejects.toMatchObject({ code: PatientsErrorCode.InvalidPatientFile });

    expect(query).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects content that is disguised with an allowed MIME type', async () => {
    const { service, query, upload } = setup();

    await expect(
      service.upload({
        clinicId: CLINIC_ID,
        childId: CHILD_ID,
        memberId: MEMBER_ID,
        file: {
          originalname: 'fake.pdf',
          mimetype: 'application/pdf',
          size: 12,
          buffer: Buffer.from('not a pdf'),
        },
      }),
    ).rejects.toMatchObject({ code: PatientsErrorCode.InvalidPatientFile });

    expect(query).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('publishes metadata only after the private object upload succeeds', async () => {
    const { service, query, upload } = setup();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row()] });

    const file = await service.upload({
      clinicId: CLINIC_ID,
      childId: CHILD_ID,
      memberId: MEMBER_ID,
      file: {
        originalname: 'scan.pdf',
        mimetype: 'application/pdf',
        size: 4,
        buffer: Buffer.from('%PDF-scan'),
      },
    });

    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${CLINIC_ID}/${CHILD_ID}/.+\\.pdf$`)),
      expect.any(Buffer),
      { contentType: 'application/pdf', upsert: false },
    );
    expect(file).toMatchObject({ childId: CHILD_ID, fileName: 'scan.pdf' });
    expect(query.mock.calls[1][0]).toContain("set status = 'ready'");
  });

  it('removes the object if publishing its metadata fails', async () => {
    const { service, query, remove } = setup();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('database down'));

    await expect(
      service.upload({
        clinicId: CLINIC_ID,
        childId: CHILD_ID,
        memberId: MEMBER_ID,
        file: {
          originalname: 'scan.pdf',
          mimetype: 'application/pdf',
          size: 4,
          buffer: Buffer.from('%PDF-scan'),
        },
      }),
    ).rejects.toMatchObject({
      code: PatientsErrorCode.PatientFileStorageFailed,
    });

    expect(remove).toHaveBeenCalledWith([
      expect.stringContaining(`${CHILD_ID}/`),
    ]);
  });

  it('returns a short-lived signed URL only for a clinic-scoped ready file', async () => {
    const { service, query, createSignedUrl } = setup();
    query.mockResolvedValueOnce({ rows: [row()] });

    const download = await service.download(
      CLINIC_ID,
      CHILD_ID,
      '44444444-4444-4444-8444-444444444444',
    );

    expect(createSignedUrl).toHaveBeenCalledWith(row().object_path, 60, {
      download: 'scan.pdf',
    });
    expect(download.url).toBe('https://storage.example.test/signed');
  });
});

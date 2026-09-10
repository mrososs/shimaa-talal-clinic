import { describe, expect, it, vi } from 'vitest';
import type { ClinicApi } from '../../clinic/clinic.api';
import { usePatientFiles } from './usePatientFiles';

const patientFile = {
  id: 'file-1',
  childId: 'child-1',
  fileName: 'report.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1200,
  uploadedByMemberId: 'member-1',
  createdAt: '2026-09-08T12:00:00.000Z',
};

function setup() {
  const api = {
    patientFiles: vi.fn().mockResolvedValue([patientFile]),
    uploadPatientFile: vi.fn().mockResolvedValue({ ...patientFile, id: 'file-2' }),
    patientFileDownload: vi.fn().mockResolvedValue({
      url: 'https://storage.example.test/signed',
      expiresAt: '2026-09-08T12:01:00.000Z',
    }),
  } as unknown as ClinicApi;
  return { api, files: usePatientFiles(api) };
}

describe('usePatientFiles', () => {
  it('loads, uploads and signs downloads through the clinic API seam', async () => {
    const { api, files } = setup();
    const upload = new File(['scan'], 'scan.pdf', { type: 'application/pdf' });

    await files.load('child-1');
    await expect(files.upload('child-1', upload)).resolves.toBe(true);
    await expect(files.download('child-1', 'file-1')).resolves.toBe(
      'https://storage.example.test/signed',
    );

    expect(api.patientFiles).toHaveBeenCalledWith('child-1');
    expect(api.uploadPatientFile).toHaveBeenCalledWith('child-1', upload);
    expect(api.patientFileDownload).toHaveBeenCalledWith('child-1', 'file-1');
    expect(files.files.value.map((file) => file.id)).toEqual(['file-2', 'file-1']);
  });
});

import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  SupabaseService,
  type QueryResultRow,
} from '@clinic/server-core';
import type { PatientFile, PatientFileDownload } from '@clinic/contracts';
import { ChildService } from './child.service';
import { PatientsError, PatientsErrorCode } from './patients.errors';

const BUCKET = 'clinic-patient-files';
const DOWNLOAD_TTL_SECONDS = 60;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface PatientFileUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface PatientFileRow extends QueryResultRow {
  id: string;
  child_id: string;
  object_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_member_id: string;
  created_at: Date;
}

const COLUMNS =
  'id, child_id, object_path, file_name, mime_type, size_bytes, ' +
  'uploaded_by_member_id, created_at';

@Injectable()
export class PatientFileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseService,
    private readonly children: ChildService,
  ) {}

  async list(clinicId: string, childId: string): Promise<PatientFile[]> {
    await this.requireChild(clinicId, childId);
    const result = await this.database.query<PatientFileRow>(
      `select ${COLUMNS} from clinic.patient_files
        where clinic_id = $1 and child_id = $2 and status = 'ready'
        order by created_at desc, id desc`,
      [clinicId, childId],
    );
    return result.rows.map(toPatientFile);
  }

  async upload(input: {
    clinicId: string;
    childId: string;
    memberId: string;
    file?: PatientFileUpload;
  }): Promise<PatientFile> {
    await this.requireChild(input.clinicId, input.childId);
    const file = requireValidFile(input.file);
    const id = randomUUID();
    const extension = safeExtension(file.originalname, file.mimetype);
    const objectPath = `${input.clinicId}/${input.childId}/${id}${extension}`;

    await this.database.query(
      `insert into clinic.patient_files
         (id, clinic_id, child_id, object_path, file_name, mime_type,
          size_bytes, uploaded_by_member_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.clinicId,
        input.childId,
        objectPath,
        cleanFileName(file.originalname),
        file.mimetype,
        file.size,
        input.memberId,
      ],
    );

    const { error } = await this.supabase.admin.storage
      .from(BUCKET)
      .upload(objectPath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error) {
      await this.database
        .query(
          `delete from clinic.patient_files where id = $1 and status = 'pending'`,
          [id],
        )
        .catch(() => undefined);
      throw storageFailed(error);
    }

    try {
      const ready = await this.database.query<PatientFileRow>(
        `update clinic.patient_files set status = 'ready'
          where id = $1 and clinic_id = $2 and status = 'pending'
          returning ${COLUMNS}`,
        [id, input.clinicId],
      );
      const row = ready.rows[0];
      if (row === undefined) throw storageFailed();
      return toPatientFile(row);
    } catch (error) {
      await this.supabase.admin.storage.from(BUCKET).remove([objectPath]);
      throw error instanceof PatientsError ? error : storageFailed(error);
    }
  }

  async download(
    clinicId: string,
    childId: string,
    fileId: string,
  ): Promise<PatientFileDownload> {
    await this.requireChild(clinicId, childId);
    const result = await this.database.query<PatientFileRow>(
      `select ${COLUMNS} from clinic.patient_files
        where id = $1 and clinic_id = $2 and child_id = $3 and status = 'ready'`,
      [fileId, clinicId, childId],
    );
    const file = result.rows[0];
    if (file === undefined) {
      throw new PatientsError(
        PatientsErrorCode.PatientFileNotFound,
        'No such file for this patient.',
      );
    }

    const { data, error } = await this.supabase.admin.storage
      .from(BUCKET)
      .createSignedUrl(file.object_path, DOWNLOAD_TTL_SECONDS, {
        download: file.file_name,
      });
    if (error || !data?.signedUrl) throw storageFailed(error);

    return {
      url: data.signedUrl,
      expiresAt: new Date(
        Date.now() + DOWNLOAD_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  private async requireChild(clinicId: string, childId: string): Promise<void> {
    if ((await this.children.findById(clinicId, childId)) === null) {
      throw new PatientsError(
        PatientsErrorCode.ChildNotFound,
        'No such child at this clinic.',
      );
    }
  }
}

function requireValidFile(file?: PatientFileUpload): PatientFileUpload {
  if (
    file === undefined ||
    file.size < 1 ||
    file.size > MAX_FILE_SIZE ||
    !ALLOWED_TYPES.has(file.mimetype) ||
    !hasExpectedSignature(file.buffer, file.mimetype)
  ) {
    throw new PatientsError(
      PatientsErrorCode.InvalidPatientFile,
      'Upload a PDF, JPG, PNG or WebP file no larger than 10 MB.',
    );
  }
  return file;
}

function hasExpectedSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'application/pdf') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (mimeType === 'image/jpeg') {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  return (
    mimeType === 'image/webp' &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function cleanFileName(name: string): string {
  const withoutControls = Array.from(name, (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  ).join('');
  const cleaned = withoutControls.replace(/[\\/]/g, '_').trim();
  return (cleaned || 'patient-file').slice(0, 255);
}

function safeExtension(name: string, mime: string): string {
  const expected: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  };
  const supplied = extname(name).toLowerCase();
  return supplied === '.jpeg' && mime === 'image/jpeg'
    ? '.jpg'
    : supplied === expected[mime]
      ? supplied
      : expected[mime];
}

function toPatientFile(row: PatientFileRow): PatientFile {
  return {
    id: row.id,
    childId: row.child_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedByMemberId: row.uploaded_by_member_id,
    createdAt: row.created_at.toISOString(),
  };
}

function storageFailed(cause?: unknown): PatientsError {
  return new PatientsError(
    PatientsErrorCode.PatientFileStorageFailed,
    'Patient file storage is temporarily unavailable.',
    cause,
  );
}

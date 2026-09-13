import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DatabaseService,
  type QueryResultRow,
  type SqlExecutor,
} from '@clinic/server-core';
import {
  type AppointmentTrackingCapability,
  type TrackingLinkRotation,
} from '@clinic/contracts';
import { BookingError, BookingErrorCode } from '@clinic/server-booking';
import { ClinicService } from '@clinic/server-clinic';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ABSOLUTE_LIFETIME_MS = 90 * 86_400_000;
const AFTER_SESSION_MS = 24 * 60 * 60_000;

interface CapabilitySeed extends QueryResultRow {
  clinic_id: string;
  appointment_id: string;
  planned_end: Date;
  created_by_member_id?: string;
  issued_at?: Date;
  absolute_expires_at?: Date;
  id?: string;
}

@Injectable()
export class AppointmentTrackingCapabilityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly clinics: ClinicService,
  ) {}

  create(
    clinicId: string,
    appointmentId: string,
    memberId: string,
  ): Promise<AppointmentTrackingCapability> {
    return this.database.transaction(async (tx) => {
      const policy = await this.clinics.findTrackingPolicy(clinicId, tx);
      if (!policy?.guestEnabled) throw unavailable();
      const result = await tx.query<CapabilitySeed>(
        `select a.clinic_id, a.id appointment_id, s.planned_end
           from clinic.appointments a
           join clinic.clinic_sessions s
             on s.id=a.session_id and s.clinic_id=a.clinic_id
          where a.id=$1 and a.clinic_id=$2
          for update of a`,
        [appointmentId, clinicId],
      );
      const seed = result.rows[0];
      if (!seed) throw unavailable();
      const issuedAt = new Date();
      const absoluteExpiresAt = new Date(issuedAt.getTime() + ABSOLUTE_LIFETIME_MS);
      const requestedExpiry = new Date(seed.planned_end.getTime() + AFTER_SESSION_MS);
      if (requestedExpiry.getTime() > absoluteExpiresAt.getTime()) {
        throw new BookingError(
          BookingErrorCode.SessionUnavailable,
          'Tracking link is not yet available for this distant appointment.',
          undefined,
          { eligibleAt: new Date(requestedExpiry.getTime() - ABSOLUTE_LIFETIME_MS).toISOString() },
        );
      }
      await tx.query(
        `update clinic.appointment_tracking_capabilities
            set revoked_at=now()
          where appointment_id=$1 and clinic_id=$2 and revoked_at is null`,
        [appointmentId, clinicId],
      );
      const token = randomBytes(32).toString('base64url');
      await tx.query(
        `insert into clinic.appointment_tracking_capabilities
          (clinic_id,appointment_id,token_hash,issued_at,absolute_expires_at,
           expires_at,created_by_member_id)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [clinicId, appointmentId, digest(token), issuedAt,
          absoluteExpiresAt, requestedExpiry, memberId],
      );
      await tx.query(
        `insert into clinic.appointment_tracking_events
          (clinic_id,appointment_id,event_type,metadata)
         values($1,$2,'capability_issued',$3)`,
        [clinicId, appointmentId,
          JSON.stringify({ expiresAt: requestedExpiry.toISOString() })],
      );
      return {
        token,
        expiresAt: requestedExpiry.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      };
    });
  }

  async resolve(token: string): Promise<{ clinicId: string; appointmentId: string }> {
    if (!TOKEN_PATTERN.test(token)) throw unavailable();
    const result = await this.database.query<CapabilitySeed>(
      `select clinic_id,appointment_id,now() planned_end
         from clinic.appointment_tracking_capabilities
        where token_hash=$1 and revoked_at is null
          and expires_at>now() and absolute_expires_at>now()`,
      [digest(token)],
    );
    const row = result.rows[0];
    if (!row) throw unavailable();
    return { clinicId: row.clinic_id, appointmentId: row.appointment_id };
  }

  async transferForReschedule(
    clinicId: string,
    originalAppointmentId: string,
    replacementAppointmentId: string,
    tx: SqlExecutor,
  ): Promise<TrackingLinkRotation | null> {
    const link = await tx.query<CapabilitySeed>(
      `select cap.id,cap.clinic_id,cap.appointment_id,cap.issued_at,
              cap.absolute_expires_at,cap.created_by_member_id,s.planned_end
         from clinic.appointment_tracking_capabilities cap
         join clinic.appointments replacement
           on replacement.id=$3 and replacement.clinic_id=cap.clinic_id
         join clinic.clinic_sessions s
           on s.id=replacement.session_id and s.clinic_id=replacement.clinic_id
        where cap.appointment_id=$1 and cap.clinic_id=$2
          and cap.revoked_at is null
        for update of cap`,
      [originalAppointmentId, clinicId, replacementAppointmentId],
    );
    const row = link.rows[0];
    if (!row?.id || !row.issued_at || !row.absolute_expires_at ||
        !row.created_by_member_id) return null;
    const requestedExpiry = new Date(row.planned_end.getTime() + AFTER_SESSION_MS);
    if (requestedExpiry.getTime() <= row.absolute_expires_at.getTime()) {
      await tx.query(
        `update clinic.appointment_tracking_capabilities
            set appointment_id=$2,expires_at=$3
          where id=$1`,
        [row.id, replacementAppointmentId, requestedExpiry],
      );
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const issuedAt = new Date();
    const absoluteExpiresAt = new Date(issuedAt.getTime() + ABSOLUTE_LIFETIME_MS);
    const inserted = await tx.query<{ id: string }>(
      `insert into clinic.appointment_tracking_capabilities
        (clinic_id,appointment_id,token_hash,issued_at,absolute_expires_at,
         expires_at,created_by_member_id)
       values($1,$2,$3,$4,$5,$6,$7) returning id`,
      [clinicId, replacementAppointmentId, digest(token), issuedAt,
        absoluteExpiresAt, requestedExpiry, row.created_by_member_id],
    );
    await tx.query(
      `update clinic.appointment_tracking_capabilities
          set revoked_at=now(),replaced_by_capability_id=$2 where id=$1`,
      [row.id, inserted.rows[0].id],
    );
    await tx.query(
      `insert into clinic.appointment_tracking_events
        (clinic_id,appointment_id,event_type,metadata)
       values($1,$2,'capability_rotated',$3)`,
      [clinicId, replacementAppointmentId,
        JSON.stringify({ originalAppointmentId })],
    );
    return { rotated: true, token, expiresAt: requestedExpiry.toISOString() };
  }

  async revoke(clinicId: string, appointmentId: string): Promise<{ revoked: true }> {
    const result = await this.database.query(
      `update clinic.appointment_tracking_capabilities set revoked_at=now()
        where appointment_id=$1 and clinic_id=$2 and revoked_at is null`,
      [appointmentId, clinicId],
    );
    if (result.rowCount === 0) throw unavailable();
    return { revoked: true };
  }
}

const digest = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest();

function unavailable(): BookingError {
  return new BookingError(
    BookingErrorCode.AppointmentNotFound,
    'Tracking link is unavailable.',
  );
}

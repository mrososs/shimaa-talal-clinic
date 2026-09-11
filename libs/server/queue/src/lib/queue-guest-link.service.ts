import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabaseService, type QueryResultRow } from '@clinic/server-core';
import {
  ClinicSessionStatus,
  DoctorPresence,
  QueueStatus,
  type GuestQueueView,
  type QueueGuestLink,
} from '@clinic/contracts';
import { ACTIVE_STATUSES } from './queue-entry.service';
import { QueueError, QueueErrorCode } from './queue.errors';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface LinkSeedRow extends QueryResultRow {
  status: QueueStatus;
  expires_at: Date;
}

interface GuestViewRow extends QueryResultRow {
  ticket_number: number;
  status: QueueStatus;
  ahead_count: string;
  now_serving_ticket_number: number | null;
  grace_expires_at: Date | null;
  session_status: ClinicSessionStatus;
  doctor_presence: DoctorPresence;
  delay_minutes: number | null;
  revision: string;
  expires_at: Date;
}

/** Revocable anonymous queue capabilities; raw tokens are never persisted. */
@Injectable()
export class QueueGuestLinkService {
  constructor(private readonly database: DatabaseService) {}

  create(
    clinicId: string,
    entryId: string,
    memberId: string,
  ): Promise<QueueGuestLink> {
    return this.database.transaction(async (tx) => {
      const seed = await tx.query<LinkSeedRow>(
        `select q.status,
                ((s.session_date + 1)::timestamp at time zone c.timezone) as expires_at
           from clinic.queue_entries q
           join clinic.clinic_sessions s
             on s.id = q.session_id and s.clinic_id = q.clinic_id
           join clinic.clinics c on c.id = q.clinic_id
          where q.id = $1 and q.clinic_id = $2
          for update of q`,
        [entryId, clinicId],
      );
      const row = seed.rows[0];
      if (row === undefined) throw unavailableEntry();
      if (
        !ACTIVE_STATUSES.includes(
          row.status as (typeof ACTIVE_STATUSES)[number],
        )
      ) {
        throw new QueueError(
          QueueErrorCode.InvalidTransition,
          'Only an active queue entry can receive a guest link.',
        );
      }
      if (row.expires_at.getTime() <= Date.now()) throw unavailableEntry();

      await tx.query(
        `update clinic.queue_guest_links
            set revoked_at = now()
          where queue_entry_id = $1 and clinic_id = $2 and revoked_at is null`,
        [entryId, clinicId],
      );

      const token = randomBytes(32).toString('base64url');
      await tx.query(
        `insert into clinic.queue_guest_links
          (clinic_id, queue_entry_id, token_hash, expires_at, created_by_member_id)
         values ($1, $2, $3, $4, $5)`,
        [clinicId, entryId, digest(token), row.expires_at, memberId],
      );
      return { token, expiresAt: row.expires_at.toISOString() };
    });
  }

  async revoke(clinicId: string, entryId: string): Promise<{ revoked: true }> {
    const result = await this.database.query(
      `update clinic.queue_guest_links link
          set revoked_at = now()
        where link.queue_entry_id = $1 and link.clinic_id = $2
          and link.revoked_at is null`,
      [entryId, clinicId],
    );
    if (result.rowCount === 0) throw unavailableEntry();
    return { revoked: true };
  }

  async read(token: string): Promise<GuestQueueView> {
    if (!TOKEN_PATTERN.test(token)) throw unavailableLink();
    const result = await this.database.query<GuestViewRow>(
      `select mine.ticket_number, mine.status,
              count(ahead.id)::text as ahead_count,
              serving.ticket_number as now_serving_ticket_number,
              mine.grace_expires_at,
              session.status as session_status,
              session.doctor_presence,
              session.delay_minutes,
              session.revision::text,
              link.expires_at
         from clinic.queue_guest_links link
         join clinic.queue_entries mine
           on mine.id = link.queue_entry_id and mine.clinic_id = link.clinic_id
         join clinic.clinic_sessions session
           on session.id = mine.session_id and session.clinic_id = mine.clinic_id
         left join clinic.queue_entries ahead
           on ahead.session_id = mine.session_id
          and ahead.status = any($2)
          and (ahead.priority, ahead.sort_key) < (mine.priority, mine.sort_key)
         left join lateral (
           select current.ticket_number
             from clinic.queue_entries current
            where current.session_id = mine.session_id
              and current.status in ('called', 'in_service')
            order by case current.status when 'called' then 0 else 1 end
            limit 1
         ) serving on true
        where link.token_hash = $1
          and link.revoked_at is null
          and link.expires_at > now()
        group by mine.id, session.id, serving.ticket_number, link.expires_at`,
      [digest(token), ACTIVE_STATUSES],
    );
    const row = result.rows[0];
    if (row === undefined) throw unavailableLink();
    return {
      ticketNumber: row.ticket_number,
      status: row.status,
      aheadCount: Number(row.ahead_count),
      nowServingTicketNumber: row.now_serving_ticket_number,
      graceExpiresAt: row.grace_expires_at?.toISOString() ?? null,
      sessionStatus: row.session_status,
      doctorPresence: row.doctor_presence,
      delayMinutes: row.delay_minutes,
      revision: Number(row.revision),
      expiresAt: row.expires_at.toISOString(),
    };
  }
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function unavailableEntry(): QueueError {
  return new QueueError(QueueErrorCode.EntryNotFound, 'No such queue entry.');
}

function unavailableLink(): QueueError {
  return new QueueError(
    QueueErrorCode.GuestLinkUnavailable,
    'This queue link is not available.',
  );
}

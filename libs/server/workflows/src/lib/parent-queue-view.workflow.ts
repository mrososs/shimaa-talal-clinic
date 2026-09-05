import { Injectable } from '@nestjs/common';
import type { SqlExecutor } from '@clinic/server-core';
import { ClinicService, ClinicSessionService } from '@clinic/server-clinic';
import { AppointmentService } from '@clinic/server-booking';
import { QueueEntryService } from '@clinic/server-queue';
import { ChildService } from '@clinic/server-patients';
import {
  ClinicSessionStatus,
  DoctorPresence,
  QueueStatus,
  type Appointment,
  type ClinicSession,
  type ParentAppointmentSummary,
  type ParentQueueItem,
  type ParentQueueView,
  type QueueEntry,
  type WaitEstimate,
} from '@clinic/contracts';

export interface ParentQueueInput {
  clinicId: string;
  guardianId: string;
}

/** Statuses whose turn has not happened yet, so a wait can still be counted. */
const PENDING: readonly QueueStatus[] = [
  QueueStatus.Waiting,
  QueueStatus.Called,
  QueueStatus.InService,
];

/**
 * What one family sees about their own children's turns.
 *
 * A composition, like the staff board, and for the same reason: the turn comes
 * from Queue, the child's name from Patients, today's visit from Booking and
 * the clinic's state from Clinic, and no one of those may see the others.
 *
 * The difference is what it refuses to assemble. The board is the whole clinic;
 * this is one family, and the shape has nowhere to put anybody else — no list,
 * no other ticket number, no other name. That is not a filter someone could
 * forget to apply, and both queries below are scoped in their WHERE clause
 * rather than filtered afterwards, which is the same idea one layer down.
 *
 * Scoped by the guardian's own children, not by whose name is on the entry. A
 * father must see his child's turn when reception wrote the mother's name on
 * it, and a walk-in registered with no guardian at all is still that child's.
 */
@Injectable()
export class ParentQueueViewWorkflow {
  constructor(
    private readonly clinics: ClinicService,
    private readonly sessions: ClinicSessionService,
    private readonly children: ChildService,
    private readonly entries: QueueEntryService,
    private readonly appointments: AppointmentService,
  ) {}

  /**
   * Everything the live-queue screen renders, or nothing if the family has no
   * business at the clinic today.
   *
   * `since` is the revision the caller already holds. It is compared before the
   * per-entry position counts are run, so a poll that finds nothing new costs
   * four small reads rather than the whole view.
   */
  async execute(
    input: ParentQueueInput,
    since?: number,
    db?: SqlExecutor,
  ): Promise<ParentQueueView | null> {
    const clinic = await this.clinics.findById(input.clinicId, db);
    if (clinic === null) return null;

    // "Today" belongs to the clinic's timezone, never to the phone's.
    const today = await this.sessions.findByDate(
      input.clinicId,
      clinic.today,
      db,
    );
    if (today.length === 0) return { items: [], revision: 0 };

    const sessionIds = today.map((session) => session.id);
    const family = await this.children.listForGuardian(
      input.clinicId,
      input.guardianId,
      db,
    );
    if (family.length === 0) return { items: [], revision: 0 };

    const [queued, booked] = await Promise.all([
      this.entries.listForChildrenInSessions(
        input.clinicId,
        family.map((child) => child.id),
        sessionIds,
        db,
      ),
      this.appointments.listForGuardianInSessions(
        input.clinicId,
        input.guardianId,
        sessionIds,
        db,
      ),
    ]);

    const byId = new Map(today.map((session) => [session.id, session]));
    const revision = pollToken(queued, booked, byId);

    // Nothing has moved since the caller last asked.
    if (since !== undefined && since === revision) return { items: [], revision };

    const items: ParentQueueItem[] = [];
    for (const child of family) {
      // The latest entry wins: a patient who was missed and put back has two,
      // and the one that matters is the one they are standing in.
      const entry = lastFor(queued, (row) => row.childId === child.id);
      const appointment = lastFor(booked, (row) => row.childId === child.id);
      if (entry === null && appointment === null) continue;

      const session = byId.get(entry?.sessionId ?? appointment?.sessionId ?? '');
      if (session === undefined) continue;

      items.push({
        childId: child.id,
        childName: child.fullName,
        appointment:
          appointment === null ? null : toParentAppointment(appointment),
        queueEntry:
          entry === null
            ? null
            : {
                id: entry.id,
                ticketNumber: entry.ticketNumber,
                status: entry.status,
                aheadCount: PENDING.includes(entry.status)
                  ? await this.entries.aheadCount(entry.id, db)
                  : 0,
                calledAt: entry.calledAt,
                graceExpiresAt: entry.graceExpiresAt,
                estimatedWaitMinutes: null,
                deferCount: entry.deferCount,
                isEmergency: entry.isEmergency,
              },
        session: {
          status: session.status,
          doctorPresence: session.doctorPresence,
          delayMinutes: session.delayMinutes,
          avgConsultMinutes: session.avgConsultMinutes,
          revision: session.revision,
        },
      });
    }

    // The estimate needs both halves of an item, so it is applied once the item
    // exists rather than threaded through its construction.
    for (const item of items) {
      if (item.queueEntry === null) continue;
      item.queueEntry.estimatedWaitMinutes = estimate(
        item.queueEntry.aheadCount,
        item.queueEntry.status,
        item.session.status,
        item.session.doctorPresence,
        item.session.avgConsultMinutes,
      );
    }

    return { items, revision };
  }
}

/**
 * A number that changes whenever anything this family can see changes.
 *
 * The sum of the revisions of every session they have a stake in, rather than
 * one session's. A guardian can have one child in the morning clinic and
 * another in the evening, and a maximum would sit still while the lower of the
 * two moved. Revisions only ever increase, so a sum only ever increases too.
 */
function pollToken(
  queued: readonly QueueEntry[],
  booked: readonly Appointment[],
  sessions: ReadonlyMap<string, ClinicSession>,
): number {
  const involved = new Set<string>();
  for (const entry of queued) involved.add(entry.sessionId);
  for (const appointment of booked) involved.add(appointment.sessionId);

  let total = 0;
  for (const id of involved) total += sessions.get(id)?.revision ?? 0;
  return total;
}

function lastFor<T>(rows: readonly T[], match: (row: T) => boolean): T | null {
  let found: T | null = null;
  for (const row of rows) if (match(row)) found = row;
  return found;
}

function toParentAppointment(
  appointment: Appointment,
): ParentAppointmentSummary {
  return {
    id: appointment.id,
    status: appointment.status,
    windowStart: appointment.windowStart,
    windowEnd: appointment.windowEnd,
    visitType: appointment.visitType,
  };
}

/**
 * A band the clinic can stand behind, or nothing at all.
 *
 * Refused unless the doctor is actually here and the queue is actually moving.
 * An estimate produced while the doctor has not arrived is arithmetic, not a
 * prediction, and a parent would leave home on it.
 *
 * Both ends round up. Rounding the lower bound down would tell a family they
 * might be seen sooner than the clinic believes, and understating a wait is the
 * direction that gets somebody standing in a corridor.
 */
function estimate(
  aheadCount: number,
  status: QueueStatus,
  sessionStatus: ClinicSessionStatus,
  presence: DoctorPresence,
  avgConsultMinutes: number,
): WaitEstimate | null {
  if (!PENDING.includes(status)) return null;
  if (sessionStatus !== ClinicSessionStatus.Open) return null;
  if (presence !== DoctorPresence.Arrived) return null;
  // Nobody ahead is not a wait of zero minutes; it is "you are next", and the
  // screen says that instead.
  if (aheadCount <= 0) return null;

  const base = aheadCount * avgConsultMinutes;
  const from = roundUpToFive(base);
  return { from, to: Math.max(from + 5, roundUpToFive(base * 1.5)) };
}

const roundUpToFive = (minutes: number): number =>
  Math.ceil(minutes / 5) * 5;

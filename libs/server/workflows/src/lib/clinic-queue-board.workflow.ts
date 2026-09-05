import { Injectable } from '@nestjs/common';
import type { SqlExecutor } from '@clinic/server-core';
import { AppointmentService } from '@clinic/server-booking';
import { QueueEntryService } from '@clinic/server-queue';
import { PatientDirectoryService } from '@clinic/server-patients';
import {
  AppointmentStatus,
  type AppointmentListItem,
  type ChildSummary,
  type ClinicSession,
  type QueueBoard,
  type QueueBoardEntry,
} from '@clinic/contracts';

/** A child the directory could not name, so a row is never dropped. */
const UNKNOWN_CHILD = (id: string): ChildSummary => ({
  id,
  fullName: '—',
  dateOfBirth: null,
});

/**
 * The screen a clinic day is run from.
 *
 * It is a composition of three domains and could not be assembled inside any
 * one of them: the order comes from Queue, the names from Patients, and who is
 * still expected from Booking. That is the whole reason this library exists,
 * and it is why the board is a read that lives here rather than a query that
 * lives in Queue.
 *
 * The two lists are deliberately separate. `entries` are the people who have
 * actually arrived; `notArrived` are appointments with no queue entry yet.
 * Merging them into one list would mean inventing a queue entry for somebody
 * who is not here — a patient the board would then offer to call.
 *
 * No transaction. Nothing is written, and a board that locked the session it
 * displays would stall the desk that is trying to use it. A row that changes
 * between the two reads shows up in the next poll, seconds later.
 */
@Injectable()
export class ClinicQueueBoardWorkflow {
  constructor(
    private readonly entries: QueueEntryService,
    private readonly appointments: AppointmentService,
    private readonly directory: PatientDirectoryService,
  ) {}

  async execute(session: ClinicSession, db?: SqlExecutor): Promise<QueueBoard> {
    const clinicId = session.clinicId;

    const [queued, booked] = await Promise.all([
      this.entries.listForSession(session.id, db),
      this.appointments.listForSession(clinicId, session.id, db),
    ]);

    // Somebody with an entry has arrived, whatever their appointment still
    // says — including the entry that was later cancelled, because inventing a
    // second arrival for them would put the same family on the board twice.
    const arrived = new Set(
      queued
        .map((entry) => entry.appointmentId)
        .filter((id): id is string => id !== null),
    );
    const expected = booked.filter(
      (appointment) =>
        appointment.status === AppointmentStatus.Confirmed &&
        !arrived.has(appointment.id),
    );

    const [children, guardians] = await Promise.all([
      this.directory.childSummaries(
        clinicId,
        [...queued, ...expected].map((row) => row.childId),
        db,
      ),
      this.directory.guardianSummaries(
        clinicId,
        [
          ...queued.map((entry) => entry.guardianId),
          ...expected.map((appointment) => appointment.guardianId),
        ].filter((id): id is string => id !== null),
        db,
      ),
    ]);

    const now = Date.now();

    return {
      session,
      revision: session.revision,

      // Already in service order. Naming rows must not reorder them, so the
      // map preserves the order the query returned.
      entries: queued.map(
        (entry): QueueBoardEntry => ({
          ...entry,
          child: children.get(entry.childId) ?? UNKNOWN_CHILD(entry.childId),
          guardian:
            entry.guardianId === null
              ? null
              : (guardians.get(entry.guardianId) ?? null),
        }),
      ),

      notArrived: expected.map(
        (appointment): AppointmentListItem => ({
          ...appointment,
          child:
            children.get(appointment.childId) ??
            UNKNOWN_CHILD(appointment.childId),
          guardian: guardians.get(appointment.guardianId) ?? {
            id: appointment.guardianId,
            fullName: '—',
            phoneE164: '',
          },
          // Late is a fact about the clock, not a state anyone sets: the window
          // has closed and they are not here.
          isLate: Date.parse(appointment.windowEnd) < now,
        }),
      ),
    };
  }

}

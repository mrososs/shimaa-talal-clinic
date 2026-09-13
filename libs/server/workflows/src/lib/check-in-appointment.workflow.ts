import { Injectable } from '@nestjs/common';
import { DatabaseService, type SqlExecutor } from '@clinic/server-core';
import { ClinicService } from '@clinic/server-clinic';
import { AppointmentService } from '@clinic/server-booking';
import { BookingError, BookingErrorCode } from '@clinic/server-booking';
import { QueueCommandService, QueueEntryService } from '@clinic/server-queue';
import {
  AppointmentStatus,
  type Appointment,
  type QueueEntry,
} from '@clinic/contracts';

export interface CheckInInput {
  clinicId: string;
  appointmentId: string;
  memberId: string;
  forceEarly?: boolean;
  earlyReason?: string | null;
}

/**
 * The patient has arrived.
 *
 * This is the one place Booking and Queue touch, and it is the reason this
 * library exists. A queue entry must appear and the appointment must become
 * `checked_in` together — a commit that did one without the other leaves either
 * a patient waiting who is not on the board, or a board entry for a visit the
 * clinic still thinks has not started.
 *
 * Neither domain may import the other, so neither can do this alone. The
 * workflow opens one transaction and passes the executor down; both domains
 * write inside it, and PostgreSQL decides whether both happen or neither.
 *
 * It holds no rules of its own. "Is this appointment eligible to check in"
 * lives in Booking, "what number does this patient get" lives in Queue. This
 * class only sequences them — if it started deciding things, the rule would
 * have two homes.
 */
@Injectable()
export class CheckInAppointmentWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly appointments: AppointmentService,
    private readonly queue: QueueCommandService,
    private readonly entries: QueueEntryService,
    private readonly clinics: ClinicService,
  ) {}

  async execute(input: CheckInInput, db?: SqlExecutor): Promise<QueueEntry> {
    const run = async (tx: SqlExecutor): Promise<QueueEntry> => {
      // Checking the same patient in twice is a double-click at a busy desk,
      // not an error, so it is answered before anything is validated. Asking
      // Booking first would refuse it: the appointment is `checked_in` by
      // then, and "not confirmed" is a true statement that answers the wrong
      // question.
      const existing = await this.entries.findByAppointment(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (existing !== null) return existing;

      const appointment = await this.eligible(input, tx);
      if (isEntry(appointment)) return appointment;

      // Two separate questions, asked in order: may they come in yet, and
      // where do they stand once they are in. The first is asked of every
      // check-in; only the second depends on how the queue is ordered.
      const arrival = await this.arrival(input, appointment, tx);
      const placement = this.placement(arrival, appointment);

      const entry = await this.queue.admit(
        {
          clinicId: input.clinicId,
          sessionId: appointment.sessionId,
          childId: appointment.childId,
          guardianId: appointment.guardianId,
          appointmentId: appointment.id,
          visitReason: appointment.notes,
          serviceEligibleAt: placement.serviceEligibleAt,
          fairnessAnchorAt: placement.fairnessAnchorAt,
        },
        { memberId: input.memberId, reason: input.earlyReason ?? null },
        tx,
      );

      await this.appointments.transition(
        input.clinicId,
        appointment.id,
        AppointmentStatus.CheckedIn,
        { memberId: input.memberId },
        tx,
      );

      return entry;
    };

    // One transaction, or the two halves can disagree. A caller that already
    // holds one passes it in rather than nesting a second.
    return db === undefined ? this.database.transaction(run) : run(db);
  }

  /**
   * May this patient come in yet?
   *
   * "Have they arrived too early" and "where does an early arrival stand in the
   * line" are different questions, and the clinic answers the first one whether
   * or not fairness placement is switched on. They were once folded into the
   * same branch, and with fairness off a 15:00 appointment could check in at
   * 10:27 — the configured boundary was never consulted. The boundary is the
   * clinic's rule; fairness is only an ordering strategy.
   *
   * The booked window is the floor every appointment has, so the answer never
   * depends on the estimator being switched on. A published recommendation is
   * consulted only when the estimator actually produced one, and can only move
   * the door later, never earlier.
   */
  private async arrival(
    input: CheckInInput,
    appointment: Appointment,
    tx: SqlExecutor,
  ): Promise<ArrivalDecision> {
    const policy = await this.clinics.findTrackingPolicy(input.clinicId, tx);
    const now = Date.now();
    const graceMs = (policy?.earlyCheckInMinutes ?? 0) * 60_000;

    let earliestAllowed = Date.parse(appointment.windowStart) - graceMs;
    if (policy?.estimatorEnabled) {
      const snapshot = await tx.query<{
        published_recommended_arrival: Date | null;
      }>(
        `select published_recommended_arrival
           from clinic.appointment_tracking_state where appointment_id=$1`,
        [appointment.id],
      );
      const recommended = snapshot.rows[0]?.published_recommended_arrival;
      if (recommended) {
        earliestAllowed = Math.max(
          earliestAllowed,
          recommended.getTime() - graceMs,
        );
      }
    }

    const early = now < earliestAllowed;
    if (early && !input.forceEarly) {
      throw new BookingError(
        BookingErrorCode.InvalidTransition,
        'This patient has arrived before the allowed check-in time.',
        undefined,
        { earliestAllowedAt: new Date(earliestAllowed).toISOString() },
      );
    }
    if (early && !input.earlyReason?.trim()) {
      throw new BookingError(
        BookingErrorCode.InvalidTransition,
        'An early check-in override requires a reason.',
      );
    }

    return {
      early,
      earliestAllowed,
      late: now > Date.parse(appointment.windowEnd),
      fairnessEnabled: policy?.fairnessEnabled ?? false,
      now,
    };
  }

  /**
   * Where the entry stands once it has been let in.
   *
   * Under fairness an overridden early arrival is held until the moment they
   * would ordinarily have been admitted, so jumping the door never buys a turn.
   * Without fairness the queue is plain arrival order, which is what the clinic
   * ran before any of this existed.
   */
  private placement(
    decision: ArrivalDecision,
    appointment: Appointment,
  ): { serviceEligibleAt: string | null; fairnessAnchorAt: string } {
    if (!decision.fairnessEnabled) {
      return {
        serviceEligibleAt: null,
        fairnessAnchorAt: new Date(decision.now).toISOString(),
      };
    }
    return {
      serviceEligibleAt: decision.early
        ? new Date(decision.earliestAllowed).toISOString()
        : null,
      fairnessAnchorAt: decision.late
        ? new Date(decision.now).toISOString()
        : appointment.windowStart,
    };
  }

  /**
   * The appointment, locked and eligible — or the entry a racing desk created.
   *
   * `findForCheckIn` takes the appointment's row lock, so two receptionists
   * checking the same patient in at the same instant meet here. The loser waits,
   * then reads a row the winner has already moved to `checked_in` and is
   * refused. That refusal is not the honest answer: the patient is in the queue,
   * which is what the caller asked for, so the winner's entry is returned
   * instead.
   *
   * The re-read matters. An appointment that is ineligible for any other reason
   * — cancelled, still awaiting approval — has no entry, so the error survives.
   */
  private async eligible(
    input: CheckInInput,
    tx: SqlExecutor,
  ): Promise<Appointment | QueueEntry> {
    try {
      return await this.appointments.findForCheckIn(
        input.clinicId,
        input.appointmentId,
        tx,
      );
    } catch (error) {
      const raced = await this.entries.findByAppointment(
        input.clinicId,
        input.appointmentId,
        tx,
      );
      if (raced !== null) return raced;
      throw error;
    }
  }
}

/** What the arrival check decided, and what placement needs to know from it. */
interface ArrivalDecision {
  /** Before the boundary, and therefore only here on an audited override. */
  early: boolean;
  earliestAllowed: number;
  late: boolean;
  fairnessEnabled: boolean;
  now: number;
}

/** Distinguishes the two things `eligible` can hand back. */
function isEntry(value: Appointment | QueueEntry): value is QueueEntry {
  return 'ticketNumber' in value;
}

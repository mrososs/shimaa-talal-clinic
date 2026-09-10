import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@clinic/server-core';
import { MessagesService } from '@clinic/server-notifications';
import { QueueCommandService } from '@clinic/server-queue';
import type { AcceptUrgentCaseResult } from '@clinic/contracts';

@Injectable()
export class AcceptUrgentCaseWorkflow {
  constructor(
    private readonly database: DatabaseService,
    private readonly messages: MessagesService,
    private readonly queue: QueueCommandService,
  ) {}

  execute(input: {
    clinicId: string;
    caseId: string;
    sessionId: string;
    memberId: string;
    decisionNote: string | null;
  }): Promise<AcceptUrgentCaseResult> {
    return this.database.transaction(async (tx) => {
      const urgent = await this.messages.lockUrgentCase(
        input.clinicId,
        input.caseId,
        tx,
      );
      const entry = await this.queue.admit(
        {
          clinicId: input.clinicId,
          sessionId: input.sessionId,
          childId: urgent.child_id,
          guardianId: urgent.guardian_id,
          visitReason: urgent.triage_note,
        },
        { memberId: input.memberId },
        tx,
      );
      const emergency = await this.queue.setEmergency(
        input.clinicId,
        entry.id,
        true,
        { memberId: input.memberId, reason: urgent.triage_note },
        tx,
      );
      const resolved = await this.messages.acceptUrgentCase(
        urgent,
        input.memberId,
        emergency.id,
        input.decisionNote,
        tx,
      );
      return { urgentCase: resolved, queueEntryId: emergency.id };
    });
  }
}

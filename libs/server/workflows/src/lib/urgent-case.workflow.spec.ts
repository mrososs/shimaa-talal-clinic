import { MessagesErrorCode } from '@clinic/server-notifications';
import { AcceptUrgentCaseWorkflow } from './urgent-case.workflow';

/**
 * Accepting an urgent case into the live queue.
 *
 * This is the one place the two domains meet, and the reason it is a workflow:
 * Messages owns the case, Queue owns the entry, and neither may see the other.
 * What is asserted here is the composition — that all four writes share one
 * transaction, and that a case which is no longer pending never reaches Queue.
 * Whether the entry is really ordered as an emergency is Queue's own suite.
 */
describe('AcceptUrgentCaseWorkflow', () => {
  const urgentRow = {
    id: 'case-1',
    clinic_id: 'clinic-1',
    thread_id: 'thread-1',
    child_id: 'child-1',
    guardian_id: 'guardian-1',
    status: 'pending',
    triage_note: 'حرارة ٣٩ ولا تستجيب للخافض',
  };

  const input = {
    clinicId: 'clinic-1',
    caseId: 'case-1',
    sessionId: 'session-1',
    memberId: 'doctor-1',
    decisionNote: 'نراها الآن',
  };

  /** One executor handed to every step, exactly as the real service does. */
  function setup() {
    const tx = { query: jest.fn() };
    const database = {
      transaction: jest.fn((work: (executor: unknown) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const messages = {
      lockUrgentCase: jest.fn().mockResolvedValue(urgentRow),
      acceptUrgentCase: jest
        .fn()
        .mockResolvedValue({ id: 'case-1', status: 'accepted' }),
    };
    const queue = {
      admit: jest.fn().mockResolvedValue({ id: 'entry-1' }),
      setEmergency: jest.fn().mockResolvedValue({ id: 'entry-1' }),
    };
    const workflow = new AcceptUrgentCaseWorkflow(
      database as never,
      messages as never,
      queue as never,
    );
    return { workflow, database, messages, queue, tx };
  }

  it('admits the child, flags the emergency and resolves the case together', async () => {
    const { workflow, database, messages, queue, tx } = setup();

    const result = await workflow.execute(input);

    expect(result).toEqual({
      urgentCase: { id: 'case-1', status: 'accepted' },
      queueEntryId: 'entry-1',
    });

    // The triage note is what the desk wrote, and it becomes the visit reason
    // rather than being retyped at the board.
    expect(queue.admit).toHaveBeenCalledWith(
      {
        clinicId: 'clinic-1',
        sessionId: 'session-1',
        childId: 'child-1',
        guardianId: 'guardian-1',
        visitReason: urgentRow.triage_note,
      },
      { memberId: 'doctor-1' },
      tx,
    );
    expect(queue.setEmergency).toHaveBeenCalledWith(
      'clinic-1',
      'entry-1',
      true,
      { memberId: 'doctor-1', reason: urgentRow.triage_note },
      tx,
    );
    expect(messages.acceptUrgentCase).toHaveBeenCalledWith(
      urgentRow,
      'doctor-1',
      'entry-1',
      'نراها الآن',
      tx,
    );

    // One transaction, and every step inside it. A case accepted without an
    // entry, or an entry admitted for a case somebody else already rejected,
    // are the two states this must not be able to produce.
    expect(database.transaction).toHaveBeenCalledTimes(1);
    for (const call of [
      messages.lockUrgentCase,
      queue.admit,
      queue.setEmergency,
      messages.acceptUrgentCase,
    ]) {
      expect(call.mock.calls[0]).toContain(tx);
    }
  });

  it('never touches the queue for a case that was already decided', async () => {
    const { workflow, messages, queue } = setup();
    messages.lockUrgentCase.mockRejectedValue(
      Object.assign(new Error('already decided'), {
        code: MessagesErrorCode.UrgentCaseAlreadyDecided,
      }),
    );

    await expect(workflow.execute(input)).rejects.toMatchObject({
      code: MessagesErrorCode.UrgentCaseAlreadyDecided,
    });

    // The lock is taken first for exactly this reason: two doctors deciding at
    // once must not put the child in the queue twice.
    expect(queue.admit).not.toHaveBeenCalled();
    expect(messages.acceptUrgentCase).not.toHaveBeenCalled();
  });
});

import { ClinicService, ClinicSessionService } from '@clinic/server-clinic';
import { QueueStatus } from '@clinic/contracts';
import { QueueCommandService } from './queue-command.service';
import { QueueEntryService } from './queue-entry.service';
import { QueueGuestLinkService } from './queue-guest-link.service';
import { QueueErrorCode } from './queue.errors';
import {
  describeWithDatabase,
  insertChild,
  insertSession,
} from './queue.fixture';

describeWithDatabase('queue guest links', (fx) => {
  const links = () => new QueueGuestLinkService(fx.db.database);
  const commands = () =>
    new QueueCommandService(
      fx.db.database,
      new QueueEntryService(fx.db.database),
      new ClinicSessionService(fx.db.database),
      new ClinicService(fx.db.database),
    );

  let sessionId: string;
  let entryId: string;

  beforeEach(async () => {
    sessionId = await insertSession(fx.db.database, {
      clinicId: fx.clinicId,
      doctorMemberId: fx.doctorMemberId,
    });
    const childId = await insertChild(
      fx.db.database,
      fx.clinicId,
      'Guest Link Child',
    );
    const entry = await commands().admit(
      {
        clinicId: fx.clinicId,
        sessionId,
        childId,
        guardianId: fx.guardianId,
      },
      { memberId: fx.doctorMemberId },
    );
    entryId = entry.id;
  });

  afterEach(async () => {
    await fx.db.database.query(
      `delete from clinic.queue_guest_links where clinic_id = $1`,
      [fx.clinicId],
    );
    await fx.db.database.query(
      `delete from clinic.queue_events
        where entry_id in (select id from clinic.queue_entries where clinic_id = $1)`,
      [fx.clinicId],
    );
    await fx.db.database.query(
      `delete from clinic.queue_entries where clinic_id = $1`,
      [fx.clinicId],
    );
    await fx.db.database.query(
      `delete from clinic.clinic_sessions where clinic_id = $1`,
      [fx.clinicId],
    );
    await fx.db.database.query(
      `delete from clinic.children where clinic_id = $1`,
      [fx.clinicId],
    );
  });

  it('stores only a digest and returns an anonymous live view', async () => {
    const link = await links().create(fx.clinicId, entryId, fx.doctorMemberId);
    const stored = await fx.db.database.query<{ token: string }>(
      `select encode(token_hash, 'base64') as token
         from clinic.queue_guest_links where queue_entry_id = $1`,
      [entryId],
    );

    expect(link.token).toHaveLength(43);
    expect(stored.rows[0]?.token).not.toContain(link.token);
    await expect(links().read(link.token)).resolves.toMatchObject({
      ticketNumber: 1,
      status: QueueStatus.Waiting,
      aheadCount: 0,
      nowServingTicketNumber: null,
    });
  });

  it('replaces the old capability instead of leaving two live links', async () => {
    const first = await links().create(fx.clinicId, entryId, fx.doctorMemberId);
    const second = await links().create(
      fx.clinicId,
      entryId,
      fx.doctorMemberId,
    );

    await expect(links().read(first.token)).rejects.toMatchObject({
      code: QueueErrorCode.GuestLinkUnavailable,
    });
    await expect(links().read(second.token)).resolves.toMatchObject({
      ticketNumber: 1,
    });
  });

  it('uses the same unavailable answer for revoked, expired and invalid tokens', async () => {
    const revoked = await links().create(
      fx.clinicId,
      entryId,
      fx.doctorMemberId,
    );
    await links().revoke(fx.clinicId, entryId);

    const expired = await links().create(
      fx.clinicId,
      entryId,
      fx.doctorMemberId,
    );
    await fx.db.database.query(
      `update clinic.queue_guest_links
          set created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'
        where queue_entry_id = $1 and revoked_at is null`,
      [entryId],
    );

    for (const token of [revoked.token, expired.token, 'invalid']) {
      await expect(links().read(token)).rejects.toMatchObject({
        code: QueueErrorCode.GuestLinkUnavailable,
      });
    }
  });

  it('does not create a link through another clinic scope', async () => {
    await expect(
      links().create(fx.otherClinicId, entryId, fx.otherDoctorMemberId),
    ).rejects.toMatchObject({ code: QueueErrorCode.EntryNotFound });
  });
});

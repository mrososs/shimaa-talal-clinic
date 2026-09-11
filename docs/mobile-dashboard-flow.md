# Mobile ↔ Dashboard Operational Flows

## Boundary

Mobile is the guardian's private view and self-service surface. Dashboard is
the clinic staff control surface. The API is authoritative for identity,
ownership, permissions, ordering and state transitions.

## Booking and approval

1. Guardian loads closure-aware availability.
2. Guardian selects child, visit type and arrival window.
3. API validates guardian-child access, clinic/session scope, capacity and
   idempotency, then creates `requested` or `confirmed` according to clinic
   policy.
4. Dashboard lists the request with guardian and child names.
5. Reception approves or rejects using the existing Booking commands.
6. Mobile polling shows the resulting status and notification.
7. Only a later staff check-in creates a Queue Entry.

## Queue and consultation

1. Reception checks in the appointment or admits a walk-in.
2. Dashboard Queue owns staff commands: Call, Start, Miss, Requeue, Cancel,
   Emergency, Move, Complete, Call Next, and Complete & Call Next.
3. Mobile calls only `GET /queue/me` and may self-defer within the server limit.
4. `Complete` finishes the current `in_service` patient only.
5. `Call Next` never completes an active consultation and rejects with
   `CurrentPatientStillInService` when one exists.
6. `Complete & Call Next` completes the current patient, synchronizes the
   linked appointment, resolves expired called patients, and calls the next
   waiting patient in one transaction.
7. Every actual transition writes a Queue event and bumps session revision once
   per command as required.
8. Mobile renders only the family's own children and queue facts; it never
   receives another patient's name, ticket or position list.

## Grace and missed flow

- `called` carries a server deadline; no client timer mutates state.
- An expired called entry becomes `missed`; its appointment becomes `no_show`.
- Paid missed visits may be rescheduled according to policy and transfer their
  payment credit to the replacement appointment.
- Pending cash is voided as `failed` on no-show (without a refund event), and a
  requeue restores the appointment and cash payment to pending.
- Pending InstaPay receipts remain under staff review; no automatic refund or
  transfer is invented.
- Expired resolution and next-patient selection are atomic for Call Next and
  Complete & Call Next.

## Payments

1. Guardian chooses cash or InstaPay for an owned appointment.
2. Cash is marked pending/expected according to clinic policy.
3. InstaPay receipt is uploaded to private storage.
4. Dashboard reviews the receipt and approves, rejects or refunds.
5. Payment events and notifications are written in the same transaction as the
   state change.

## Messages and urgent triage

1. Guardian creates or opens a thread for an owned child.
2. Guardian and staff exchange idempotent replies.
3. Guardian may mark a message urgent after seeing emergency guidance.
4. Dashboard triages the urgent case.
5. Doctor/admin acceptance invokes `AcceptUrgentCaseWorkflow`; it creates the
   queue entry and updates urgent state atomically.
6. A concurrent second decision loses cleanly and cannot create a duplicate
   queue entry.

## Growth

1. Doctor or authorized staff records measurements during the visit.
2. Mobile reads a sanitized child growth view containing measurements only.
3. Clinical diagnosis, investigations, treatment instructions, drafts and
   internal notes remain Dashboard-only.

## Guest queue link

1. Reception generates a link for a checked-in entry.
2. API creates a random opaque 256-bit capability token, stores only its SHA-256
   digest, and expires it at the end of the clinic-local session day.
3. Dashboard offers copy/share and can revoke the active link. Creating a new
   link for the same entry revokes the previous one.
4. Public endpoint returns ticket, now-serving number, approximate count ahead,
   session status and expiry.
5. The public Mobile page lives outside authentication and the tab shell and
   polls every fifteen seconds.
6. Invalid, expired or revoked tokens return the same generic not-available
   response, without revealing whether a token ever existed.

## Notifications

Notifications are created only after a successful transaction and are scoped to
the owning guardian. Initial delivery is in-app polling with deep links. The
existing `notification_outbox` remains the future boundary for push/SMS/WhatsApp
workers.

# Mobile API and Contract Tasks

## Existing contracts to preserve

- `MeResponse`, guardian/child identity and claim-code contracts.
- `Appointment`, availability, appointment list/detail and status contracts.
- `ParentQueueResponse`, `ParentQueueItem` and revision/unchanged responses.
- Shared API envelope and domain error conventions.

## New or extended contracts

Add framework-free types under `libs/contracts`:

- Phone OTP contracts are deferred with the phone-login phase. When added,
  authentication stays a direct Supabase Auth concern rather than a NestJS
  business endpoint.
- `ParentAppointmentDetail` with payment and queue summaries where permitted.
- `ParentPayment`, payment status and receipt upload result.
- `ParentMessageThread`, parent thread detail and notification summary.
- `ParentGrowthView` and sanitized measurement history.
- `ParentUrgentCase` and urgent request result.
- `ParentNotification`.
- `GuestQueueView`.

Nest validation DTOs stay in the owning server library and must not be exported
from contracts.

## Parent routes

Conceptual routes, following the existing URI versioning and naming rules:

| Route | Purpose |
| --- | --- |
| `GET /me/notifications` | List guardian notifications |
| `POST /me/notifications/:id/read` | Mark one notification read |
| `GET /messages` | List own threads |
| `POST /messages` | Create own-child thread idempotently |
| `GET /messages/:threadId` | Read own thread |
| `POST /messages/:threadId/replies` | Idempotent guardian reply |
| `POST /messages/:threadId/read` | Mark staff replies read for this guardian |
| `POST /messages/:threadId/urgent` | Raise urgent case |
| `GET /payments` | List own payments |
| `POST /payments` | Create payment intent/choose method |
| `POST /payments/:id/receipt` | Upload private InstaPay receipt |
| `GET /children/:childId/growth` | Read sanitized growth data |
| `POST /urgent-cases` | Create urgent request when no thread exists |
| `GET /queue/guest/:token` | Public read-only guest queue view |

Existing parent appointment and queue routes remain unchanged unless a contract
extension is required. Staff queue routes remain under `clinic/queue`; the
workflow controller owns cross-domain commands.

## Security and ownership contract

- Guardian and clinic are derived from auth context.
- Every child, appointment, payment, thread and notification is checked against
  the guardian's relationship in the same clinic.
- Growth responses exclude encounter text, temperature, appointment IDs and
  staff metadata; the contract cannot accidentally serialize them.
- A foreign resource returns the existing generic not-found behavior.
- Receipt downloads use short-lived signed URLs from a private bucket.
- Guest responses contain no names, phone numbers, message content, payment data
  or clinical information.
- No browser bundle receives `SUPABASE_SECRET_KEY`, `DATABASE_URL` or service
  credentials.

## Error codes

Add stable client-mappable codes for:

- invalid/expired OTP (next phone-auth phase);
- appointment/payment ownership failure;
- receipt invalid type/size;
- closed thread;
- urgent case already decided;
- notification not found;
- guest link expired/revoked;
- queue grace not expired/current patient still in service where relevant.

## Consistency and idempotency

- Booking uses a client request key or equivalent duplicate protection.
- New message threads and replies use `clientRequestId`.
- Payments use an idempotency key per guardian submission.
- Queue and appointment synchronization is one transaction with session row lock
  where applicable.
- Events and in-app notification records are inserted before commit; rollback
  removes all related changes.

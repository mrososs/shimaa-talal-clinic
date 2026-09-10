# Mobile Release and Verification Checklist

## Static checks

- [ ] `pnpm nx lint mobile`
- [ ] `pnpm nx typecheck mobile` or the repository's equivalent target.
- [ ] `pnpm nx test mobile`
- [ ] `pnpm nx build mobile`
- [ ] Contracts, API, workflows, Booking and Queue tests pass.
- [ ] No forbidden cross-domain imports.

## Database/Supabase checks

- [ ] Migration dry run succeeds and is forward-only.
- [ ] Composite tenant constraints are present and tested.
- [ ] New tables have forced RLS and explicit grants.
- [ ] Private storage buckets reject invalid MIME/size and public access.
- [ ] Real-database tests clean their fixtures.
- [ ] No secret key or database URL appears in a Vite bundle.

## Browser checks

Use the actual local ports documented by the running workspace:

- Mobile: `http://localhost:4202`
- Dashboard: `http://localhost:4203`
- API: `http://localhost:3000`

At Mobile viewport 412×892 verify:

- [ ] email auth, password recovery and onboarding;
- [ ] booking and pending approval;
- [ ] appointments/detail/manage;
- [ ] queue waiting/called/in-service/missed/paused;
- [ ] payment and receipt states;
- [ ] messages and urgent guidance;
- [ ] growth read-only view;
- [ ] guest link view;
- [ ] RTL, keyboard focus, safe area and no horizontal overflow.

At Dashboard viewport 1280×820 verify:

- [ ] request shows guardian and child names;
- [ ] queue commands remain explicit;
- [ ] complete does not call next;
- [ ] complete-and-call-next is atomic;
- [ ] messages/urgent/payment/growth updates are reflected in Mobile;
- [ ] fixed sidebar remains non-scrollable;
- [ ] role restrictions are enforced by API and reflected in UI.

## Cross-role journey

- [ ] Parent creates booking.
- [ ] Reception approves it.
- [ ] Reception checks in the child.
- [ ] Parent sees waiting state.
- [ ] Reception calls and starts.
- [ ] Doctor completes or completes-and-calls-next.
- [ ] Parent sees final queue/appointment state.
- [ ] Doctor records measurement; parent sees only allowed data.
- [ ] Parent messages staff and raises an urgent case.
- [ ] Doctor accepts urgent case without duplicate queue entry.
- [ ] Staff reviews payment receipt.
- [ ] Guest token works anonymously and expires correctly.

## Concurrency and failure checks

- [ ] Two simultaneous Complete & Call Next requests cannot double-complete or
  double-call.
- [ ] Duplicate booking, payment and message submissions are idempotent.
- [ ] Paused session rejects every listed queue command with no mutation/event/
  revision bump.
- [ ] Failed cross-domain operation rolls back all domains and notifications.
- [ ] Slow polling response cannot overwrite a newer screen state.

## Capacitor smoke

- [ ] Capacitor sync succeeds after the web build.
- [ ] Auth redirect/deep links work in the native shell.
- [ ] Safe-area insets and keyboard behavior are correct.
- [ ] Native push is not required for this release; in-app polling remains the
  fallback until a future notification-provider task is approved.

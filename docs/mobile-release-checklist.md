# Mobile Release and Verification Checklist

## Static checks

- [x] `pnpm nx lint mobile`
- [x] `pnpm nx typecheck mobile` or the repository's equivalent target.
- [x] `pnpm nx test mobile`
- [x] `pnpm nx build mobile`
- [x] Contracts, API, workflows, Booking and Queue tests pass.
- [ ] No forbidden cross-domain imports.

## Database/Supabase checks

- [x] Migration dry run succeeds and is forward-only.
- [x] Composite tenant constraints are present and tested.
- [x] New tables have forced RLS and explicit grants.
- [ ] Private storage buckets reject invalid MIME/size and public access.
- [x] Real-database tests clean their fixtures.
- [x] No secret key or database URL appears in a Vite bundle.

## Browser checks

Use the actual local ports documented by the running workspace:

- Mobile: `http://localhost:4202`
- Dashboard: `http://localhost:4203`
- API: `http://localhost:3000`

At Mobile viewport 412×892 verify:

- [ ] email auth, password recovery and onboarding;
- [x] booking and pending approval;
- [ ] appointments/detail/manage;
- [ ] queue waiting/called/in-service/missed/paused;
- [ ] payment and receipt states;
- [ ] messages and urgent guidance;
- [ ] growth read-only view;
- [x] guest link view;
- [x] RTL, keyboard focus, safe area and no horizontal overflow.

At Dashboard viewport 1280×820 verify:

- [x] request shows guardian and child names;
- [x] queue commands remain explicit;
- [ ] complete does not call next;
- [ ] complete-and-call-next is atomic;
- [ ] messages/urgent/payment/growth updates are reflected in Mobile;
- [x] fixed sidebar remains non-scrollable;
- [x] role restrictions are enforced by API and reflected in UI.

## Cross-role journey

- [x] Parent creates booking.
- [x] Reception approves it.
- [x] Reception checks in the child.
- [x] Parent sees waiting state.
- [x] Reception calls and starts.
- [x] Doctor completes or completes-and-calls-next.
- [x] Parent sees final queue/appointment state.
- [ ] Doctor records measurement; parent sees only allowed data.
- [ ] Parent messages staff and raises an urgent case.
- [ ] Doctor accepts urgent case without duplicate queue entry.
- [x] Staff reviews a parent-originated cash payment.
- [x] Guest token works anonymously and exposes no patient identity.

## Concurrency and failure checks

- [ ] Two simultaneous Complete & Call Next requests cannot double-complete or
  double-call.
- [x] Duplicate booking, payment and message submissions are idempotent.
- [x] Paused session rejects every listed queue command with no mutation/event/
  revision bump.
- [x] Failed cross-domain operation rolls back all domains and notifications.
- [x] Slow polling response cannot overwrite a newer screen state.

## Browser-first PWA

- [x] Production build emits `manifest.webmanifest` and `sw.js`.
- [x] Service-worker policy has no API, Auth, REST, or Storage runtime caching.
- [x] Installation, update prompt, and offline UI have component/composable tests.
- [x] Production API rejects wildcard or missing CORS origins.
- [ ] Official 192, 512, maskable 512, and Apple Touch icons are supplied.
- [ ] Chrome Application installability and Cache Storage checks pass.
- [ ] Vercel HTTPS deep links and explicit production CORS allow-list pass.
- [ ] Android Chrome standalone installation and full flow pass.
- [ ] Physical iPhone Safari Add to Home Screen, safe areas, and full flow pass.
- [ ] Capacitor dependencies/config/targets/generated projects are removed only
  after every preceding PWA item passes.

See [parent-pwa-deployment.md](parent-pwa-deployment.md) for the deployment and
final removal gate.

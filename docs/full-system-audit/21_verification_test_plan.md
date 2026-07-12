# Verification test plan

Do not run production-changing cases without separate approval. Use isolated test identities/projects and redact all secrets/codes.

## Finding verification tests

### F-001 — Direct deal publication bypass

- **Preconditions:** remediation deployed to isolated/staging Supabase; approved/pending/suspended/unpaid businesses and locations seeded.
- **Test account type:** owner for each state plus a different-business owner.
- **Test environment:** staging/dev Supabase, then approved production negative probe only.
- **Exact action:** call PostgREST directly to insert an active deal and update draft/publication fields, bypassing the app/function; repeat through official publish.
- **Expected result:** direct unauthorized transitions are denied; official publish succeeds only when every canonical predicate passes.
- **Forbidden result:** any ineligible/cross-owner active deal or partial state change.
- **Database state to verify:** no unauthorized deal/version mutation; eligible publish has one consistent active version.
- **Audit-log state to verify:** denial/success codes and actor/target correlation without payload secrets.
- **Cleanup steps:** remove isolated fixtures with approved test cleanup.
- **Production access required:** only for final read-only catalog and approved negative synthetic probe.
- **Can be automated:** yes, RLS integration/concurrency suite.

### F-002 — Pending business public discovery

- **Preconditions:** lifecycle/location fixtures for pending, rejected, approved, suspended, verified/unverified, located/unlocated.
- **Test account type:** anonymous/shopper and owners.
- **Test environment:** staging/dev database.
- **Exact action:** query direct business selects, nearby/search RPCs, map fallback, deal joins, share lookup, and counts.
- **Expected result:** only approved public businesses/locations and safe columns appear.
- **Forbidden result:** any hidden lifecycle row, unlocated bypass, or private field.
- **Database state to verify:** fixture state remains unchanged.
- **Audit-log state to verify:** public-read telemetry is aggregated and privacy-safe if logged.
- **Cleanup steps:** delete fixtures in staging.
- **Production access required:** read-only catalog/output spot-check after approval.
- **Can be automated:** yes.

### F-003 — Shared business invite

- **Preconditions:** new scoped invite/application mechanism and fixtures for valid, expired, used, wrong-user/domain/scope.
- **Test account type:** normal shopper, intended recipient, attacker account.
- **Test environment:** staging/dev.
- **Exact action:** inspect client bundle for reusable authority; submit valid and invalid/replayed/scoped requests; attempt direct business insert.
- **Expected result:** client has no universal authority; only intended one-time/scoped flow creates a safely pending application.
- **Forbidden result:** replay, cross-user use, approval/access assignment, or public discovery.
- **Database state to verify:** one pending record for the valid action; no invalid rows/privileged fields.
- **Audit-log state to verify:** validation/use/rejection with actor and invite ID/hash only, never token value.
- **Cleanup steps:** revoke fixtures and remove staging applications.
- **Production access required:** no for automation; approved synthetic verification may be used.
- **Can be automated:** yes.

### F-004 — Claim grace period

- **Preconditions:** deterministic clock/test database and claim/deal fixtures.
- **Test account type:** shopper, authorized redeemer/staff, unrelated account.
- **Test environment:** test/staging; controlled devices later.
- **Exact action:** claim/release/new-claim/redeem one second before, at, and after nominal expiration and grace expiration; issue parallel requests.
- **Expected result:** claim remains singular and redeemable through the agreed grace boundary; transitions are atomic/idempotent.
- **Forbidden result:** premature expiry, second active logical claim, double redemption, or stuck redeeming.
- **Database state to verify:** exactly one permitted terminal transition and consistent timestamps/status.
- **Audit-log state to verify:** one outcome per idempotency key/correlation with no claim/QR token value.
- **Cleanup steps:** remove isolated claims/deals/devices.
- **Production access required:** no for automation; controlled production-like device smoke only.
- **Can be automated:** yes, including parallel tests.

### F-005 — Client-controlled Stripe price/source

- **Preconditions:** Stripe test mode, allowlisted server product, remediated function, owner fixtures.
- **Test account type:** eligible/ineligible owner and non-owner/admin-negative account.
- **Test environment:** staging + Stripe test mode.
- **Exact action:** submit allowed product key, forged `price_id`, `source=test`, wrong environment/mode, and another account price.
- **Expected result:** server ignores/rejects unauthorized selectors; created Session contains only configured allowlisted price/mode.
- **Forbidden result:** a Session or charge using caller-selected price/test bypass.
- **Database state to verify:** only valid pending checkout record; no entitlement before verified webhook.
- **Audit-log state to verify:** sanitized denial/creation metadata, no Stripe secrets or full session payload.
- **Cleanup steps:** expire test sessions/customers per test procedure.
- **Production access required:** no for primary test; live config read-only confirmation requires approval.
- **Can be automated:** yes with Stripe test fixtures/mocks plus integration.

### F-006 — Billing token race

- **Preconditions:** single-use token fixture and atomic consume implementation.
- **Test account type:** intended owner plus attacker/replay client.
- **Test environment:** staging + Stripe test mode/mock.
- **Exact action:** send 10 synchronized requests with the same token.
- **Expected result:** exactly one consumes the token and reaches Session creation; others return stable rejection.
- **Forbidden result:** multiple Sessions or `use_count` above limit.
- **Database state to verify:** atomic use count/used timestamp and one checkout correlation.
- **Audit-log state to verify:** one success, nine replay denials, token value never logged.
- **Cleanup steps:** expire/remove fixture and test Sessions.
- **Production access required:** no.
- **Can be automated:** yes.

### F-007 — Native dependency health

- **Preconditions:** clean clone/install using supported Node/package manager and proposed dependency resolution.
- **Test account type:** none for static checks; shopper/owner for device smoke.
- **Test environment:** Windows local Android debug, then approved EAS iOS/Android candidates.
- **Exact action:** run deterministic install, `npm ls react-native --all`, Expo Doctor, Metro bundle, local Android launch/screenshot-mode path, approved build/install.
- **Expected result:** one SDK-compatible React Native, all Doctor checks pass or explicitly supported exception, app launches core routes.
- **Forbidden result:** duplicate RN, native crash, New Architecture failure, unsupported forced Expo upgrade.
- **Database state to verify:** none.
- **Audit-log state to verify:** build logs contain no secrets.
- **Cleanup steps:** stop local processes; retain only approved artifacts.
- **Production access required:** EAS/store only under approval; no DB access.
- **Can be automated:** static/Android portions yes; device/store partly manual.

### F-008 — Website onboarding mobile checks

- **Preconditions:** approved current copy/layout and patched checker/page in preview.
- **Test account type:** anonymous visitor; no submission needed for layout.
- **Test environment:** local/preview across mobile/desktop browsers.
- **Exact action:** run both website checks; navigate by keyboard/screen reader to jump and form; test smallest viewport and large text.
- **Expected result:** checks pass; explicit jump focuses/scrolls to a fully accessible form at the approved mobile position.
- **Forbidden result:** stale-copy-only pass, hidden/clipped form, focus loss, or accidental submission.
- **Database state to verify:** none unless a separately approved test submission is used.
- **Audit-log state to verify:** no sensitive form content in client logs.
- **Cleanup steps:** remove any preview-only synthetic submission.
- **Production access required:** safe live GET/visual smoke after approved deploy.
- **Can be automated:** mostly; screen-reader quality needs manual testing.

### F-009 — Share landing resolution

- **Preconditions:** safe lookup endpoint/page and fixtures for all share/deal/business states.
- **Test account type:** anonymous and installed-app shopper.
- **Test environment:** staging website/database, then safe public GET.
- **Exact action:** open valid, expired, redeemed, disabled, deleted, missing, malformed, and case-varied codes on desktop/iOS/Android.
- **Expected result:** approved safe preview for valid code; state-appropriate non-enumerating response; correct deep/store fallback.
- **Forbidden result:** generic false success, private fields/internal IDs, cross-business data, or code enumeration.
- **Database state to verify:** lookup is read-only and returns only approved projection.
- **Audit-log state to verify:** aggregated/rate-limited access without raw codes where avoidable.
- **Cleanup steps:** remove staging fixtures.
- **Production access required:** safe GET after approved deploy; valid synthetic code requires approval.
- **Can be automated:** yes, with device link handling partly manual.

### F-010 — Store destinations

- **Preconditions:** approved live App Store/Play listing URLs.
- **Test account type:** anonymous visitor.
- **Test environment:** preview, then production website on iOS/Android/desktop.
- **Exact action:** activate every download/share fallback CTA with installed and uninstalled app.
- **Expected result:** correct official listing or app route with approved campaign parameters.
- **Forbidden result:** null/placeholder/wrong-package listing, redirect loop, or broken scheme.
- **Database state to verify:** none.
- **Audit-log state to verify:** only consented/approved aggregate campaign data.
- **Cleanup steps:** none.
- **Production access required:** yes for final listing links, read-only navigation.
- **Can be automated:** URL/HTTP checks yes; store/app handoff manual.

### F-011 — Auth configuration drift

- **Preconditions:** approved Auth policy and read-only hosted settings access; dedicated email accounts.
- **Test account type:** new unconfirmed user, confirmed user, reset user.
- **Test environment:** dev/staging then controlled production email test.
- **Exact action:** compare local/hosted settings; signup; try login before confirmation; resend; confirm; weak password; reset/replay; secure change.
- **Expected result:** confirmation remains required, password policy enforced, redirect/templates work, replay/expired links fail.
- **Forbidden result:** unconfirmed access, weak-password acceptance against policy, open redirect, reusable reset.
- **Database state to verify:** profile/session state matches confirmation and no duplicate/orphan profile.
- **Audit-log state to verify:** stable auth outcomes without email token/link contents.
- **Cleanup steps:** delete dedicated test identity through approved procedure.
- **Production access required:** yes for settings/final delivery test.
- **Can be automated:** config/dev flows yes; delivery partially manual.

### F-012 — Stale source-of-truth/release checks

- **Preconditions:** generated inventory/checker contract sourced from current config and approved product copy.
- **Test account type:** none.
- **Test environment:** clean repository checkout/CI.
- **Exact action:** compare reported version/package/flags/migrations/functions to parsed source and safe hosted inventory; run all release checkers.
- **Expected result:** docs and gates agree with source; real injected mismatch fails with actionable output.
- **Forbidden result:** hard-coded stale counts/copy, false green, secrets in output.
- **Database state to verify:** none; hosted inventory read-only.
- **Audit-log state to verify:** CI artifact contains names/counts only, no sensitive config values.
- **Cleanup steps:** remove injected test mismatch fixture.
- **Production access required:** only read-only inventory portion.
- **Can be automated:** yes.

### F-013 — Remote-only AI function

- **Preconditions:** authoritative source/caller decision, file-specific AI approval, deployment approval, desired inventory manifest.
- **Test account type:** unauthorized user and authorized dev AI account if retained.
- **Test environment:** separate AI Studio dev project; production inventory read-only.
- **Exact action:** search all callers/releases; verify desired-vs-hosted inventory; if retained test auth/quota/facts/errors; if retired prove route unavailable and callers use replacement.
- **Expected result:** every active function has reviewed source/tests/owner, or obsolete function is absent with no callers.
- **Forbidden result:** unknown active bundle, unauthenticated cost path, raw provider error, fact mutation.
- **Database state to verify:** expected quota/usage metadata only; no unintended publication.
- **Audit-log state to verify:** cost/correlation/error code without prompts/secrets/private payload unless explicitly approved.
- **Cleanup steps:** remove dev drafts/usage fixtures; no production deploy without approval.
- **Production access required:** yes for inventory and any retirement; success path should use dev project.
- **Can be automated:** inventory/auth/fallback yes; provider quality partly manual.

## Proposed release smoke test

Run first in a dedicated staging/dev project, then only the explicitly approved non-destructive subset against production.

1. **Customer signup:** create email/password shopper with optional birthday/ZIP; verify confirmation email and no access before confirm.
2. **Customer login:** confirm, log in, verify stored shopper role routing; log out and prove old session denial.
3. **Location:** grant/deny device location and use valid/invalid ZIP; verify privacy and fallback.
4. **Deal discovery:** approved deal appears in list/map/search; pending/rejected/suspended business/deal does not.
5. **Favorite:** add/remove across refresh/device; other user cannot read/write it.
6. **Notification consent:** deny/allow/revoke; preference and push-token behavior stay consistent.
7. **Deal claim:** claim eligible deal once; repeat/cooldown/ineligible paths fail correctly.
8. **Deal redemption:** authorized staff/device redeems once across nominal/grace boundaries; duplicate/cross-business fails.
9. **Share Deal:** generate/open link without exposing private data or codes in logs.
10. **Public share preview:** valid safe facts and correct invalid/expired states; installed/store fallback works.
11. **Business application:** authorized application mechanism creates pending non-public row only.
12. **Business approval:** admin with required role/MFA approves; unauthorized role denied; audit event recorded.
13. **Trial access:** approved eligible business receives exactly intended trial state; expiry behavior is correct.
14. **Terms acceptance:** current version required and recorded; stale/missing acceptance blocks publish.
15. **Deal creation:** owner creates fact-correct draft; cross-owner and invalid facts fail.
16. **Deal publication:** official transition succeeds only when every canonical predicate passes; direct REST bypass fails.
17. **Staff redemption:** authorized active staff/device succeeds once; revoked/unrelated staff fails and is audited.
18. **Admin authorization:** signed-out and each lower role are denied outside matrix; privileged mutations require MFA/reason/audit.
19. **Stripe webhook processing:** test-mode allowed Checkout, signed event, duplicate/out-of-order event, entitlement reconciliation, wrong-price denial.
20. **Subscription gating:** eligible trial/paid states publish as intended; expired/canceled/suspended states follow approved hide/claim/redeem semantics.
21. **Account logout:** local state cleared and protected APIs reject old/removed session.
22. **Account deletion/deactivation:** only in isolated test environment or under explicit destructive approval; verify Auth/profile/business/favorites/claims/push/storage/processor handling and re-login denial.


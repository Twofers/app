# Prioritized remediation plan

No fixes are authorized by this audit. Each batch is a separate scoped implementation/review, in dependency order.

## Batch 1 — Authorization and data isolation

**Findings addressed:** F-001, F-002.  
**Why these belong together:** Both require one database-authoritative definition of publishable/public business and deal state.  
**Files likely affected:** new forward migration; deal/public-business data clients; publish callers; RLS tests.  
**Database objects likely affected:** `deals`, `businesses`, locations, nearby/search/share RPCs, owner/public policies, `can_business_publish`.  
**Edge Functions likely affected:** `publish-offer-version`, public business/share functions.  
**Preconditions:** approve lifecycle semantics for pending/rejected/suspended/unverified/billing-ineligible states.  
**Implementation order:** define predicates; write negative tests; add forward migration; route official mutations; update reads; update docs.  
**Required tests:** modified-client direct REST insert/update; cross-owner; every lifecycle/location/terms/billing combination; public map/search/share isolation.  
**Deployment order:** client-compatible server/function changes, approved migration, immediate RLS smoke/catalog check, clients.  
**Rollback approach:** forward corrective migration restoring last safe access while disabling publication; never edit applied history.  
**Production verification:** read-only policy/grant/RPC comparison plus approved synthetic negative probes.  
**Regression risks:** hiding valid businesses/deals, breaking owner edits, recurring offers, or redemption of existing claims.  
**Recommended model capability:** senior database-security and Supabase/RLS implementation model.  
**Recommended reasoning level:** very high.

## Batch 2 — Claims and redemption correctness

**Findings addressed:** F-004.  
**Why these belong together:** Claim, release, redeem, wallet, and cleanup must share one time/state invariant.  
**Files likely affected:** shared claim helper, claim/release/redeem/wallet functions, focused tests, possible forward migration.  
**Database objects likely affected:** claims, redemption state/functions/constraints.  
**Edge Functions likely affected:** `claim-deal`, `release-claim`, visual/token/staff redeem, stale finalizer, wallet sync.  
**Preconditions:** product decision on new claims/release during grace.  
**Implementation order:** specify state machine; centralize effective expiry; update all consumers; add races/time tests.  
**Required tests:** before/at/after nominal and grace expiry; double claim/redeem; claim-vs-release; retries; two devices; DST/time zone.  
**Deployment order:** backward-compatible helper/schema if needed, all functions together, then client display changes.  
**Rollback approach:** disable new claims if invariant fails; preserve redemption of already valid claims; forward correction.  
**Production verification:** controlled test business/deal/accounts only, with sensitive codes kept out of logs.  
**Regression risks:** stranded claims, duplicate redemptions, incorrect wallet state, owner notifications.  
**Recommended model capability:** senior distributed-state/concurrency implementation model.  
**Recommended reasoning level:** very high.

## Batch 3 — Billing and subscription correctness

**Findings addressed:** F-005, F-006.  
**Why these belong together:** Checkout authorization, token consumption, Stripe price, and entitlement must form one server-owned transaction chain.  
**Files likely affected:** Stripe checkout function/shared billing helpers/tests and a forward migration/RPC.  
**Database objects likely affected:** billing checkout tokens, subscriptions, events, product/price configuration.  
**Edge Functions likely affected:** `stripe-create-checkout-session`, checkout-link functions, webhook/reconciliation.  
**Preconditions:** approve products/prices, live/test separation, allowed purchase surfaces, token semantics.  
**Implementation order:** server allowlist; atomic token RPC; negative/concurrency tests; webhook reconciliation tests; docs.  
**Required tests:** forged source/price, token replay race, duplicate/out-of-order webhook, wrong price, cancel/refund/trial transitions.  
**Deployment order:** atomic DB primitive, checkout function, webhook if needed, then surfaces; use Stripe test mode first.  
**Rollback approach:** disable Checkout creation while preserving webhook reconciliation/portal; forward corrective deploy.  
**Production verification:** approved test-mode and narrowly controlled live configuration/read-only verification.  
**Regression risks:** blocked legitimate checkout, charged-without-access, duplicate entitlement, trial loss.  
**Recommended model capability:** senior payments/security implementation model.  
**Recommended reasoning level:** very high.

## Batch 4 — Admin privileged actions

**Findings addressed:** F-015 (design concern).  
**Why these belong together:** Signed-out shell minimization and server role/MFA/audit proof cover one privileged boundary.  
**Files likely affected:** admin static shell/router, admin auth/session helpers, role-matrix tests.  
**Database objects likely affected:** admin roles, audit log policies/functions if gaps are found.  
**Edge Functions likely affected:** admin function family.  
**Preconditions:** approve role-to-section/action matrix and MFA requirements.  
**Implementation order:** inventory endpoints; negative tests; minimize shell; close object/action gaps; verify audit events.  
**Required tests:** signed out, each role, MFA absent/present, cross-section/object, mutation audit, downgrade/revoke.  
**Deployment order:** server restrictions before shell changes; migration/function deploy only with approval.  
**Rollback approach:** fail closed or disable affected admin mutation; never relax server auth to restore UI.  
**Production verification:** dedicated non-production/admin test accounts; production read-only role/config review.  
**Regression risks:** locking out support/finance, missing audit events, overbroad read access.  
**Recommended model capability:** senior application-security model.  
**Recommended reasoning level:** high.

## Batch 5 — Authentication and account state

**Findings addressed:** F-011.  
**Why these belong together:** Local/hosted confirmation, password, reset, callback, and deletion behavior need one approved policy.  
**Files likely affected:** `supabase/config.toml`, auth UI/error localization, auth/deletion tests and runbooks.  
**Database objects likely affected:** profile/auth cleanup helpers only if testing finds gaps.  
**Edge Functions likely affected:** `delete-user-account`; possibly auth-adjacent handlers.  
**Preconditions:** read-only hosted Auth settings export and approved password/confirmation policy.  
**Implementation order:** compare settings; align local; test confirmation/reset/session/revocation/deletion; document.  
**Required tests:** unconfirmed login, resend, reset expiry/replay, role routing, logout token invalidation, deletion cleanup.  
**Deployment order:** configuration/template changes under approval, then client/runbook changes.  
**Rollback approach:** restore last approved settings/templates; do not disable confirmation as a workaround.  
**Production verification:** hosted settings and controlled email/device test.  
**Regression risks:** login lockout, redirect failure, email deliverability, incomplete deletion.  
**Recommended model capability:** senior identity/security model.  
**Recommended reasoning level:** high.

## Batch 6 — Business onboarding and terms

**Findings addressed:** F-003 and onboarding portion of F-008.  
**Why these belong together:** Merchant authority, application review, terms, and website entry are one acquisition boundary.  
**Files likely affected:** business invite/setup clients, start-trial page/CSS/checkers, application/admin review tests.  
**Database objects likely affected:** invite/application validation records, businesses trigger/policies.  
**Edge Functions likely affected:** application/request/context/terms functions.  
**Preconditions:** choose one-time invitation vs reviewed open application and public lifecycle rules.  
**Implementation order:** replace shared authority; preserve safe pending defaults; fix web journey; test review/terms transitions.  
**Required tests:** reuse/expiry/scope, impersonation attempts, pending/reject/approve, terms versions, mobile web form.  
**Deployment order:** server gate before client removal; website deploy after checker pass; approval required.  
**Rollback approach:** pause new business applications while retaining admin review of existing records.  
**Production verification:** synthetic non-public application and read-only queue/audit check.  
**Regression risks:** blocking legitimate invitations, orphan applications, accidentally public pending rows.  
**Recommended model capability:** senior full-stack identity/workflow model.  
**Recommended reasoning level:** high.

## Batch 7 — Notifications and deep links

**Findings addressed:** F-009, F-010 dependencies; notification/deep-link test gaps.  
**Why these belong together:** Share acquisition, app links, store fallback, push taps, and wallet links share routing/configuration.  
**Files likely affected:** app linking/config, share landing, store-links config, push/wallet handlers/tests.  
**Database objects likely affected:** public share lookup and push-token data only if gaps emerge.  
**Edge Functions likely affected:** deal-link/share lookup, push and wallet issue/sync.  
**Preconditions:** approved store URLs, public share projection, link-domain ownership.  
**Implementation order:** safe lookup; web states; app/store routing; push/wallet deep links; device matrix.  
**Required tests:** valid/invalid links, installed/not installed, killed/background app, stale token, duplicate notification.  
**Deployment order:** server/web compatibility, associations/config, clients, store URLs last when listings live.  
**Rollback approach:** serve safe generic page and disable problematic campaign links without exposing data.  
**Production verification:** public safe links plus controlled devices; never disclose live codes in reports.  
**Regression risks:** broken routing, enumeration, private metadata, notification loops.  
**Recommended model capability:** senior mobile/web integration model.  
**Recommended reasoning level:** high.

## Batch 8 — Mobile customer flows

**Findings addressed:** F-004/F-007 downstream and mobile test gaps.  
**Why these belong together:** After server invariants are fixed, end-to-end customer UX can be trusted and stabilized.  
**Files likely affected:** shopper tabs/detail/wallet/settings, native dependencies/config, E2E fixtures.  
**Database objects likely affected:** none expected beyond prior batches.  
**Edge Functions likely affected:** none expected beyond prior batches.  
**Preconditions:** Batches 1-3 and clean Expo Doctor.  
**Implementation order:** deterministic install; debug bundle/device; auth/browse/favorite/claim/share/logout/delete; accessibility.  
**Required tests:** slow/offline/retry/background, smallest devices, EN/ES/KO, account lifecycle.  
**Deployment order:** local debug first; EAS/store builds only after explicit approval.  
**Rollback approach:** feature flags for optional surfaces; server fail-safe for claim/billing; previous approved build.  
**Production verification:** controlled beta devices and accounts.  
**Regression risks:** native crash, navigation loops, stale state, inaccessible controls.  
**Recommended model capability:** senior React Native/Expo model.  
**Recommended reasoning level:** high.

## Batch 9 — Business-owner and staff flows

**Findings addressed:** F-001/F-003/F-005/F-006 downstream and staff test gaps.  
**Why these belong together:** Owner publish/billing and staff redeem UX must consume the corrected server boundaries.  
**Files likely affected:** owner create/edit/dashboard/billing/account and staff redemption/device routes/tests.  
**Database objects likely affected:** none beyond prior batches unless workflow gaps emerge.  
**Edge Functions likely affected:** publish, billing, terms, redemption-device/staff functions.  
**Preconditions:** Batches 1-3 and approved lifecycle matrix.  
**Implementation order:** owner application/terms; create/publish/edit; trial/billing; staff/device redeem; recovery UX.  
**Required tests:** every eligibility state, cross-business staff, revoked device, concurrent redeem, payment failure.  
**Deployment order:** server compatibility then clients; controlled beta before broad release.  
**Rollback approach:** disable new publish/checkout while preserving safe redeem/portal access.  
**Production verification:** dedicated business/staff test identities.  
**Regression risks:** owner lockout, valid deals hidden, staff unable to redeem, billing confusion.  
**Recommended model capability:** senior product/full-stack model.  
**Recommended reasoning level:** high.

## Batch 10 — Public website

**Findings addressed:** F-008, F-009, F-010.  
**Why these belong together:** These are the public acquisition/conversion routes and their automated gates.  
**Files likely affected:** `website/` HTML/CSS/JS, store links, share page, crawlers/checkers.  
**Database objects likely affected:** public share lookup only if projection changes.  
**Edge Functions likely affected:** public share endpoint if introduced.  
**Preconditions:** approved copy, store URLs, share output and abuse policy.  
**Implementation order:** fix mobile onboarding; implement safe share states; set store links; accessibility/SEO/security tests.  
**Required tests:** all viewports/routes/forms/errors, keyboard/screen reader, no-JS, share states, CTA links.  
**Deployment order:** staging/preview, approved website deploy, live smoke.  
**Rollback approach:** atomic static rollback to prior deploy; keep server lookup backward compatible.  
**Production verification:** safe GETs only unless form submissions explicitly approved.  
**Regression risks:** conversion loss, private data exposure, broken redirects/deep links.  
**Recommended model capability:** senior web/accessibility model.  
**Recommended reasoning level:** medium-high.

## Batch 11 — AI accuracy and safeguards

**Findings addressed:** F-013.  
**Why these belong together:** Remote inventory, source, prompts, cost, privacy, validation, and locks must be reviewed as one AI surface.  
**Files likely affected:** only explicitly approved AI function/tests/docs/lock files; possibly deployment inventory.  
**Database objects likely affected:** AI quota/usage/prompt metadata if restoration requires it.  
**Edge Functions likely affected:** `ai-refine-ad-copy` disposition and current AI function family.  
**Preconditions:** file-by-file AI lock approval and deploy approval; identify live consumers/source.  
**Implementation order:** inventory/callers; restore source for review or prove obsolete; tests/cost/privacy; retire/redeploy.  
**Required tests:** auth/quota, fact fidelity, injection, provider failure, sanitized errors, deterministic fallback, cost ceiling.  
**Deployment order:** callers first if retiring; function action under approval; post-deploy inventory/smoke.  
**Rollback approach:** disable AI surface and use deterministic/manual fallback; never restore unknown bundle blindly.  
**Production verification:** active inventory, safe failure path, controlled dev-provider success only.  
**Regression risks:** fact changes, cost abuse, provider data leakage, broken creation.  
**Recommended model capability:** senior AI application-security model.  
**Recommended reasoning level:** very high.

## Batch 12 — Accessibility and localization

**Findings addressed:** accessibility/localization consequences of F-008/F-009 plus test gaps.  
**Why these belong together:** Copy/layout/state changes need EN/ES/KO and assistive-tech verification together.  
**Files likely affected:** localization resources, approved UI/web components, fixtures/gates.  
**Database objects likely affected:** none expected.  
**Edge Functions likely affected:** stable error codes only if gaps emerge.  
**Preconditions:** final product copy/states from prior batches.  
**Implementation order:** extract copy; semantic labels/focus/scaling; language expansion; manual matrix; gates.  
**Required tests:** screen reader, keyboard, large text, contrast, reduced motion, EN/ES/KO facts/layout.  
**Deployment order:** server codes before localized clients; website/client after review.  
**Rollback approach:** retain stable codes and previous complete translations; never show raw provider errors.  
**Production verification:** controlled device/browser matrix.  
**Regression risks:** clipped facts, mistranslation, inaccessible critical action.  
**Recommended model capability:** accessibility/localization specialist model.  
**Recommended reasoning level:** high.

## Batch 13 — Performance and observability

**Findings addressed:** F-014, F-016.  
**Why these belong together:** Supported dependencies, performance budgets, telemetry, alerts, and incident ownership establish operational reliability.  
**Files likely affected:** dependencies/lockfile, privacy-safe telemetry, dashboards/runbooks/config.  
**Database objects likely affected:** operational event/retention tables only if approved.  
**Edge Functions likely affected:** shared logging/metrics and critical functions.  
**Preconditions:** approved monitoring provider/data inventory/retention and Expo upgrade path.  
**Implementation order:** assess advisory reachability; supported upgrades; define signals/budgets; add alerts/runbooks; load tests.  
**Required tests:** dependency gates, cold/bundle/memory/API/web budgets, alert firing, log redaction, outage drills.  
**Deployment order:** dashboards first, instrumentation gradually, dependency/client releases after QA.  
**Rollback approach:** disable noisy instrumentation; roll back supported dependency change; preserve core audit events.  
**Production verification:** dashboards and synthetic alerts without customer data.  
**Regression risks:** privacy leakage, performance overhead, alert fatigue, native breakage.  
**Recommended model capability:** senior platform/SRE model.  
**Recommended reasoning level:** high.

## Batch 14 — Automated tests and release controls

**Findings addressed:** F-012 and closure evidence for F-001 through F-013.  
**Why these belong together:** Generated inventories and invariant tests prevent recurrence across every release surface.  
**Files likely affected:** current-state/deployment docs, check scripts, CI/release checklists.  
**Database objects likely affected:** none; read-only catalog queries/fixtures may be added.  
**Edge Functions likely affected:** inventory manifest only.  
**Preconditions:** prior batches define authoritative expected state.  
**Implementation order:** generate version/migration/function/config facts; remove stale assertions; add P1/P2 regression gates; document blocked/manual checks.  
**Required tests:** clean checkout CI, desired-vs-hosted dry run, negative RLS/auth, website/native gates, smoke-plan rehearsal.  
**Deployment order:** CI/docs first; no production deploy needed unless closing drift under separate approval.  
**Rollback approach:** revert faulty checker only with recorded reason; never suppress a real failing invariant.  
**Production verification:** read-only inventory output and post-approved-deploy comparison.  
**Regression risks:** false green, false failures, leaked config values, credit-consuming builds.  
**Recommended model capability:** senior release-engineering model.  
**Recommended reasoning level:** high.


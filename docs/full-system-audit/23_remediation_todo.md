# Remediation work log / TODO

Working checklist for executing `20_prioritized_remediation_plan.md`. Started 2026-07-11.
Nothing below authorizes a production action; every apply/deploy/build remains Dan-gated.

## Status legend

- `[ ]` not started  `[~]` in progress  `[x]` done locally (code + tests)  `[D]` blocked on Dan

## Done so far (this session)

- [x] Read full audit package (findings register, exec summary, detail docs for DB/RLS, claims, billing, edge functions).
- [x] Verified the five P1 defects against current code first-hand:
  - F-001: `deals_owner_insert`/`deals_owner_update` in `20260812130000_consolidate_deals_rls_policies.sql` check ownership only; official publish goes through `publish-offer-version` → service-role RPC `publish_offer_versioned_deal`, so RLS tightening cannot break it. App does direct client `deals` updates only in `dashboard.tsx` (pause/resume/end) and locked `app/create/ai.tsx` (edit path; client already gates on `canPublish`, no locked-file change needed).
  - F-002: `"Anyone can read businesses" USING (true)` (initial schema) is still the row policy; `20260705120000` only restricted columns. Nearby RPCs are SECURITY INVOKER, so a fixed row policy also fixes them.
  - F-004: `claim-deal/index.ts:525-551` bulk-expires and filters at nominal `expires_at`; `release-claim/index.ts:91-104` same; shared grace rule lives in `_shared/claim-redeem.ts` (`expires_at + grace_period_minutes`, default 10).
  - F-005: `stripe-create-checkout-session/index.ts` — client `source:"test"` bypasses the purchase-surface gate (line 257), client `price_id` overrides server config (line 264).
  - F-006: `useBillingToken` (lines 143-163) is read-then-update; fixable without a migration via compare-and-swap conditional update (`.eq("use_count", readValue)` + require returned row).
- [x] Spec pass (partial — the original 14-agent workflow died at an API session limit after producing Batches 3/4/5 specs; remaining mapping relaunched as 5 targeted agents for Batches 1/6/10/13/14).

## Progress update (2026-07-12 早)

- [x] **Batch 2 implemented**: `claim-deal` sweep + active-claim gate and `release-claim` expiry now use the shared redeem deadline (`expires_at + grace`) via `_shared/claim-redeem.ts`; per-row guarded expiry updates; new `supabase/functions/_shared/claim-grace-consistency-source.test.ts` (5 tests green). Verified all other consumers (begin/complete visual, redeem-token, finalize-stale-redeems, wallet, client `lib/claim-redeem-deadline`) were already grace-aware. `[D]` deploy claim-deal + release-claim.
- [x] **Batch 3 implemented**: new migration `20260813120000_consume_billing_token_rpc.sql` (atomic `consume_billing_token`, service-role only); checkout + portal functions consume via the RPC; client `price_id` authority removed; `source:"test"` removed and source derived server-side (token→email, admin only with verified role); portal audit-source pinned; source tests extended; new db suite `scripts/db-tests/2d-billing-token-consume.mjs` (race/negatives/privilege — needs migration applied to TEST project). `[D]` apply migration (test→prod), then deploy both functions (ORDER MATTERS: migration first).
- [x] **Batch 4 implemented**: `/admin` signed-out shell is now minimal (no IA/endpoints); dashboard markup moved to token-gated fetched fragment `website/admin/app.html`; `admin.js` restructured (shell helpers + initDashboard after injection; 401 → login); source tests updated + new minimal-shell guard test. `[D]` website deploy.
- [x] **Batch 5 implemented**: config.toml aligned (confirmations ON, min length 8, secure_password_change ON); signup now enforces the 8-char minimum with the localized reset-screen copy (`app/auth-landing.tsx`); new guard test `supabase/functions/_shared/auth-config-source.test.ts` (7 tests green). `[D]` hosted Auth verification.
- [x] **Batch 7/8/9/12 closed**: audit docs 04/07/12/17 confirm no standalone locally-fixable defects — everything is inherited from F-001..F-006 (fixed in Batches 1-3/6) or device/manual QA (Dan-gated).
- [x] **Batch 11 done**: zero callers of `ai-refine-ad-copy`; retirement recommendation in `24_ai_refine_ad_copy_disposition.md`. `[D]` hosted `supabase functions delete`.
- [x] **Batch 14 core done**: `scripts/generate-release-state.mjs` (+ `npm run release:state` / `gate:release-state`), generated `docs/release-audit/generated-state.{md,json}`, CI drift step added to `.github/workflows/ci.yml`. Ground truth: v1.0.0, androidVersionCode **49**, 136 migrations, 72 functions, PAID_BILLING_ENABLED=true, PILOT_DISABLE_BILLING_GATE=false. Stale-doc line corrections pending the doc-inventory agent.
- [x] **Batch 1 implemented**: migration `20260814120000_public_business_predicate_and_publish_gate.sql` — businesses public SELECT policy hides draft/pending_verification/rejected (owner OR-clause keeps owners seeing their own row; nearby RPCs are SECURITY INVOKER so they inherit the fix); deals_owner_insert/update WITH CHECK gates live-capable rows on `can_business_publish` (COALESCE false). New suite `2e-public-visibility-and-publish-gate.mjs`; `2c` seeds updated to status active; guard test `authz-guardrails-source.test.ts`. `[D]` apply to test → probes → prod.
- [x] **Batch 6 implemented**: migration `20260814130000_business_open_application_gate.sql` — shared "penguin" secret removed (RPC accepts any non-empty code for old-client compat; trigger v3 = service-role bypass + one-self-created-business-per-owner cap, rejected/archived don't count); invite UI removed from auth-landing + business-setup; `lib/business-invite.ts` deleted. ⚠️ PRODUCT CHANGE for Dan to confirm: business signup becomes open application (pending + inert + hidden + admin review) instead of invite-code. `[D]` apply migration BEFORE next app build.
- [x] **Batch 10 implemented**: start-trial hero jump gets `trial-jump` class + mobile CSS reorder (form right after hero; UI crawl now passes 34 routes/2 viewports incl. the ≤760px form-top gate); stale checker copy assertion repointed to `data-i18n="trial.jump"`; NEW `deal-share-lookup` edge function (wraps anon-safe `lookup_deal_share`, web projection only) + state-aware `/s/` page (checking/valid/expired/unavailable/error, EN/ES/KO keys, no-JS fallback, store CTAs null-safe). `[D]` deploy function + website; real store URLs.
- [x] **Batch 13 implemented**: F-007 RESOLVED — npm overrides pin `react-native` (phantom nested 0.86.0 pruned from lockfile) + postcss ≥8.5.10; `expo-doctor` now 18/18 (react-native-launch-arguments kept — it powers dev-only screenshot mode via lib/screenshot-mode.ts — and excluded from the directory check per Doctor's own advice). F-014: postcss advisory cleared; uuid advisory ACCEPTED (build-only via xcode/prebuild, unreachable path; forcing v11 across 4 majors risks breaking iOS prebuild — Dan's call to revisit). F-016: `docs/operations-monitoring-runbook.md` + raw-error-object logging redacted in ingest-analytics-event.
- [x] **Batch 14 completed**: stale doc lines corrected in deployment-notes/deployment-command-plan/release-audit/current-state (now pointing at generated state); `validate-ai-studio-dev-config.mjs` versionCode assertion reads app.json instead of hardcoded 31 (was failing on every run).
- [x] **Gates all green** (2026-07-12): typecheck, lint, `npm test` 1579/1579 (252 files, AI-poster-lock pretest passing), typecheck:functions, expo-doctor 18/18, both website checkers, release-state drift gate, both localization gates.
- [x] **Adversarial review complete** (5 finder agents / 8 angles over the full diff). Fixed as a result:
  - Pending-but-paying publish hole: `can_business_publish` alone does not exclude `pending_verification` when an active subscription exists → new `is_publicly_visible_business()` helper (single source of the hidden-status list), required by BOTH deals write policies and the businesses SELECT policy; new `2e` check covers it.
  - Prod policy drift: migration 20260814120000 now dynamically drops ALL permissive SELECT policies on `businesses` (prod has documented hand-created drift), not just known names.
  - Racy per-owner business cap → `pg_advisory_xact_lock` serializes concurrent inserts.
  - Portal `source` spoof (authenticated caller could label a session "email") → pinned to `merchant_web`.
  - Raw error objects in edge logs (both billing token consumers) → code+message only.
  - Share-preview identity leak for later-hidden businesses → `deal-share-lookup` re-checks business visibility.
  - claim-deal sweep batched into one UPDATE; both claim functions now use shared `isPastRedeemDeadline`; idempotent claim response now carries `grace_period_minutes`.
  - RLS publish-denial UX: dashboard resume/bulk-resume shows a specific localized message; trigger's "business limit reached" mapped via `translateKnownApiMessage`; ~27 orphaned invite locale keys removed (EN/ES/KO).
  - Share-code regex parity test added; admin shell comments corrected to state the true property.
- [x] **Final gates re-run, all green**: 1580 tests / 252 files, typecheck, lint, typecheck:functions, both website checkers, release-state drift gate.

## Review findings accepted (not fixed) — Dan visibility

- `/admin/app.html` is still a public static file (recon-only; all data behind server auth). Full gating needs Vercel middleware.
- `can_business_publish` prefers a stale `business_subscriptions` row over `location_entitlements` (pre-existing); with the DB gate live, a business with a stale canceled sub but valid entitlements could be blocked from direct live-writes while the app shows good standing. Approve the lifecycle matrix (plan precondition) and clean stale sub rows if seen.
- The AI-locked `app/create/ai.tsx` edit path can hit the new RLS denial for lapsed-eligibility owners editing a LIVE deal; the error is generic (`translateKnownApiMessage` maps RLS to a localized permission message). A friendlier message there requires Dan's locked-file approval.
- `uuid <11.1.1` advisory accepted (build-only, unreachable; forcing v11 risks iOS prebuild).
- Old checkout deploys may have used the typo'd env var `STRIPE_PRICE_ID_TWOFer_PRO_MONTHLY`; verify hosted secret names / `app_runtime_config` price rows BEFORE deploying the checkout function.

## Remaining work

### Batch 1 — Authorization and data isolation (F-001, F-002)  `[~ specs in flight]`
- [ ] New forward migration: public-business lifecycle predicate (hide pending_verification / rejected / suspended / disabled / archived; keep NULL-status legacy rows visible to avoid hiding valid businesses) applied to the `businesses` public SELECT policy; keep owner access via existing SECURITY DEFINER helpers, add owner-select policy if client code reads own row directly.
- [ ] Same migration: tighten `deals_owner_insert`/`deals_owner_update` WITH CHECK so a live-capable row (`is_active AND end_time > now()`) requires `COALESCE((can_business_publish(business_id)->>'canPublish')::boolean, false)`. Owners can always pause/deactivate/edit non-live rows.
- [ ] Confirm every public read path is covered (nearby RPCs are SECURITY INVOKER → inherit the fix; check share lookup RPC + any other SECURITY DEFINER readers individually).
- [ ] Negative tests in `scripts/db-tests/` (direct REST insert/update as ineligible owner, cross-owner, anon reads of pending business) + probe additions.
- [ ] Graceful client handling for the resume path in `app/(tabs)/dashboard.tsx:918` (RLS denial → friendly message, EN/ES/KO).
- [D] Apply migration to test project → probes → prod apply → `probe-rls-smoke` (Dan).

### Batch 2 — Claims/redemption grace consistency (F-004)  `[~ specs in flight]`
- [ ] Centralize effective expiry on `_shared/claim-redeem.ts`; use it in `claim-deal` (bulk-expire + active-set filter) and `release-claim` (expiry check).
- [ ] Per-row expiry updates (grace varies per claim) with conditional guards; no new claim while an existing claim is inside its grace window; decide release-during-grace semantics (default: allow release of `active` claims, keep `redeeming` claims releasable only via cancel path — confirm against visual-redeem cancel function).
- [ ] Boundary/race tests (before/at/after nominal and grace; double claim; claim-vs-release; retries).
- [D] Deploy `claim-deal`, `release-claim` (+ any touched shared module consumers) (Dan).

### Batch 3 — Billing correctness (F-005, F-006)  `[~ specs in flight]`
- [ ] `stripe-create-checkout-session`: drop client `price_id` authority entirely (server resolves from config/env only); restrict `source:"test"` to verified admins on a non-live Stripe key (or remove); keep legit callers working (enumerate: mobile billing screens, tokenized email checkout, admin, website).
- [ ] Atomic token consume: single conditional UPDATE with CAS on `use_count` + `revoked_at IS NULL` + expiry in the WHERE, require exactly one returned row.
- [ ] Tests: forged source/price ignored, token replay race consumes once.
- [D] Deploy function; any Stripe dashboard/price config (Dan).

### Batch 4 — Admin shell minimization (F-015)  `[ ]`
- [ ] `website/admin/index.html`: signed-out visitors get a minimal noindex sign-in shell with no internal IA; signed-in rendering unchanged.
- [D] Website deploy (Dan).

### Batch 5 — Auth config alignment (F-011)  `[~ grounded]`
- [ ] `supabase/config.toml`: `enable_confirmations = true`, `minimum_password_length` raised (8), `secure_password_change = true` — align desired-state file with locked policy (email confirmation ON).
- [D] Read-only hosted Auth settings verification + any hosted changes (Dan).

### Batch 6 — Business onboarding gate (F-003)  `[~ specs in flight]`
- [ ] Replace shared `"penguin"` code authority: chosen default = reviewed open application (pending-by-default + existing admin review) or server-issued one-time invite codes — final call after spec agent maps the approval flow; migration + `lib/business-invite.ts` + screens + EN/ES/KO + reuse/expiry/cross-user tests.
- [D] Apply migration, deploy touched functions (Dan). Product sign-off on the chosen gate model (Dan).

### Batch 7 — Deep links / notifications routing (F-009/F-010 deps)  `[~ specs in flight]`
- [ ] Fix only confirmed app/server routing gaps (push-tap deep links, stale tokens, duplicate notifications) per spec agent evidence.
- [D] Store URLs (listings don't exist yet); device-matrix QA (Dan).

### Batch 8 — Mobile customer flows  `[~ specs in flight]`
- [ ] Apply only locally-fixable, unit-testable shopper-flow defects from audit doc 04 (may be empty).
- [D] Device QA, Expo Doctor-clean build precondition (Dan / Batch 13).

### Batch 9 — Owner/staff flows  `[~ specs in flight]`
- [ ] Same treatment for owner/staff surfaces from audit doc 07 (may be empty). Includes graceful handling of new server denials introduced by Batches 1/3.
- [D] Device QA (Dan).

### Batch 10 — Public website (F-008, F-009, F-010)  `[~ specs in flight]`
- [ ] `website/business/start-trial/`: fix mobile layout/jump-affordance defects; reconcile checker assertions (stale contract vs real failure) per checker runs.
- [ ] `website/s/` share page: state-aware lookup via `lookup_deal_share` (valid/expired/redeemed/disabled/missing/malformed), safe projection only, app deep link + null-safe store fallback, a11y + no-JS fallback.
- [ ] Local verification: `npm run check:website-supabase`, `npm run check:website-ui`.
- [D] Website deploy; real store URLs (Dan).

### Batch 11 — Legacy AI function disposition (F-013)  `[~ specs in flight]`
- [ ] Caller inventory for `ai-refine-ad-copy` (expect zero); write retirement recommendation doc; feed expected-function list into Batch 14's generated inventory.
- [D] Hosted function deletion (Dan). No AI-locked file edits.

### Batch 12 — Accessibility / localization  `[~ specs in flight]`
- [ ] Standalone confirmed a11y/l10n defects (labels, hardcoded strings) + EN/ES/KO for all new copy from other batches; run localization gates.
- [D] Manual screen-reader/device matrix (Dan).

### Batch 13 — Dependencies + observability (F-007, F-014, F-016)  `[~ specs in flight]`
- [ ] Lockfile analysis: duplicate `react-native` parents; postcss/uuid advisory chains; apply only minimal safe fixes (likely npm `overrides`), flag native-graph changes to Dan.
- [ ] Monitoring/alert runbook doc (signals, owners, retention, drills).
- [D] Native dependency upgrades, `npx expo-doctor` verification build, monitoring provider decisions (Dan).

### Batch 14 — Release truth (F-012)  `[~ specs in flight]`
- [ ] `scripts/generate-release-state.mjs`: emit app version/versionCode, migration count + latest, local function list, key flags; write generated doc; drift check vs committed copy.
- [ ] Correct the specific stale doc assertions (deployment-notes, current-state).
- [D] Hosted-inventory half (needs credentials) documented as optional (Dan).

### Final phase  `[ ]`
- [ ] Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run typecheck:functions`, website checkers, `npm run test:db` (test project), localization gates.
- [ ] Adversarial multi-agent review of the complete diff; fix confirmed findings.
- [ ] Final report: what changed, what's ready-to-apply/deploy, exact Dan-gated action list in dependency order.
- Note: everything stays uncommitted unless Dan asks for commits.

## DEPLOYED TO PRODUCTION — 2026-07-12

Dan approved "deploy everything" (invite→open-application product change included) and chose to skip the test-project pre-validation and go straight to prod, verifying with live probes.

- [x] **3 migrations applied to prod** (`supabase db push --linked`): 20260813120000, 20260814120000, 20260814130000. Clean apply.
- [x] **`probe-rls-smoke.mjs` 7/7 PASS** immediately after; `probe-deals-rls.mjs` 3/3 PASS; live anon reads confirm approved businesses (2) + live deals (4) still visible (predicate returns approved rows, not everything/nothing).
- [x] **6 edge functions deployed to prod**: claim-deal, release-claim, ingest-analytics-event, deal-share-lookup, stripe-create-checkout-session, stripe-customer-portal-session. All fail-closed 401 verified; deal-share-lookup returns safe invalid/not_found states; `gate:edges` all HEALTHY.
- [x] **Price config verified before Stripe deploy**: prod has `STRIPE_TWOFER_BUSINESS_PRICE_ID` + `STRIPE_PRICE_ID` set; the removed typo'd fallback was never present, so removal is a no-op. Checkout resolves a price.
- [x] **Website deployed to Vercel prod** (`vercel deploy --prod`, authed as dansanders-2432). Live verified: /admin shows minimal "Restricted access" shell with no internal IA/endpoints; /admin/app.html served with noindex header; /s/<code> wired to deal-share-lookup with state panels; /business/start-trial has the trial-jump class.

Residual (unchanged from accepted-risk list): /admin/app.html is publicly fetchable (recon-only, noindex applied; full gating needs Vercel middleware). Everything remains UNCOMMITTED in git — deploy was direct, not via a push.

## Standing constraints

- No `supabase db push`, no function deploys, no website deploy, no builds, no hosted config/secret changes — prepare everything, execute nothing gated.
- Never edit AI-locked files (`docs/ai-poster-core-lock.json` list) — `app/create/ai.tsx` is locked; Batch 1 design deliberately avoids touching it.
- Never edit applied migrations; forward-only.
- All new user-facing copy lands in EN/ES/KO localization files.

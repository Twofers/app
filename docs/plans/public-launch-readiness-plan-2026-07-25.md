# Public-launch readiness plan — 2026-07-25

**Executor:** an AI agent (Opus) running in Claude Code on this repo (Phases A–B), then Dan (Phases C–E).
**Owner:** Dan. **This file is both the plan and the tracker** — update Status columns in place.
**Verdict this plan implements:** the code and backend are launch-grade, but do NOT build tonight. Five things stand between here and a safe public day 1: (1) a working-tree landmine that would poison the Android build, (2) a few small client fixes that must ride this rebuild or wait months for the next one, (3) console settings only Dan can check — one of which silently breaks Google sign-in on iOS only, (4) staged store verification, because Apple sign-in and Google-on-iOS have never been executed anywhere, and (5) a website deploy that carries the admin comp-grant UI (currently NOT live) and the privacy-policy update the new sign-in providers require.

---

## 0. Verified state this plan builds on (audited 2026-07-25, this session)

Everything below was re-verified today — not assumed from notes:

- **Local gates all green at HEAD `afeeedcd`:** `typecheck`, `typecheck:functions`, `lint` (0), `check:i18n-keys`, `gate:release-state`, `npm test` 282 files / 1984 tests. CI green on the last two pushes.
- **Backend parity is exact.** `supabase migration list --linked`: every local migration `local == remote` through `20260822180000` (all five merchant-onboarding fixes and both claim-links migrations are applied to prod). `supabase functions list`: **79 deployed == 79 local folders, all ACTIVE**, newest deploy 2026-07-25 (`ai-generate-ad-variants` v200). The two newest commits touch no backend files. **Nothing committed is undeployed on the backend.**
- **Production build profile is correct at HEAD:** `eas.json` production has `EXPO_PUBLIC_ENABLE_SOCIAL_AUTH="true"` with real (non-placeholder) Google web + iOS client IDs, no debug flags, mobile-billing flags off (intended), and the held poster-viewer-language flags correctly absent. `app.json`: version `1.0.1`, `ios.usesAppleSignIn: true`, both sign-in plugins, correct bundle/package ids. Committed `android/app/build.gradle` is production-correct. No `ios/` dir (EAS prebuilds iOS cleanly).
- **The 2026-07-24 rare-feature QA sweep** (docs/plans/pre-launch-rare-feature-qa-plan-2026-07-24.md) stands: zero open P0 anywhere; merchant-onboarding P0s (F-23/F-24) fixed **and applied to prod**; RLS denial 14/14 + smoke 7/7; all admin fns gated; delete-account proven end-to-end.
- **es/ko localization fixes are committed** (`80fb6a10`, `064f82a3`) and will ship with this rebuild.
- **Live website matches the repo** (asset `?v=` parity + the 07-23 LCP marker are live) **EXCEPT** `website/admin/trial-requests.js`: the live file (418 lines) predates commit `90f41f46` (473 lines) — **the admin comp-grant UI is committed but NOT deployed** (verified by diffing the live file against HEAD).
- **Auth email is on verified custom SMTP** (Resend, DKIM/SPF, docs/SMTP_SWAP_CHECKLIST.md) — but the Supabase auth email rate limit is **30/hour** (checklist §D), a real day-1 ceiling.
- **No crash-reporting SDK exists in the app** (no sentry/bugsnag/crashlytics in package.json). Day-1 visibility = store consoles + Supabase logs.
- Android Google sign-in matrix closed green on the S10 (2026-07-25), including the immutable-role race fix. **iOS is the untested half.**

## 1. Hard rules (inherited from CLAUDE.md — they all apply)

1. NO builds, store submissions, deploys (functions or website), migrations, pushes, or credential changes without Dan's explicit per-action approval. Phases C–E are Dan-gated by design.
2. AI poster/ad lock: before touching ANY file covered by `docs/ai-poster-core-lock.json` (including `CLAUDE.md`/`AGENTS.md` and `app/create/ai.tsx` — see B5), stop and get per-file approval, then update hashes and CHAIN `latestApprovalRef` ("… Prior ref: <old>").
3. Preserve all untracked artifacts and unrelated WIP. Never print secrets, tokens, QR/claim codes.
4. Client-only fixes: implement + validate locally; commit only when Dan approves. One scoped task at a time.
5. Validation after each Phase B item: `npm run typecheck && npm run lint && npm test`, plus `npm run check:i18n-keys` and `node scripts/check-i18n-defaultvalue-gaps.mjs` for anything touching copy. New user-facing strings go to en/es/ko, never `defaultValue`-only.

---

## Phase A — Working-tree hygiene (Opus, ~30 min, BEFORE anything else)

`eas.json` sets no `cli.requireCommit`, so **EAS uploads the dirty working tree as-is**. The tree must be clean-by-intention before any build.

| # | Task | Why | Status |
|---|------|-----|--------|
| A1 | `git restore android/app/build.gradle` and verify `git diff android/` is empty | The tree's uncommitted diff switches `applicationId`/`namespace` to `com.unvmex2.twoforone.dev` and **deletes the google-services plugin line** (dev-APK leftovers). Built as-is: wrong package (store rejects the AAB) and FCM/Google-services dead. Committed HEAD version is correct — restore, don't edit. | ☐ |
| A2 | ONE commit pairing `website/vercel.json` + `website/scripts/` (+ `docs/website-edit-checklist.md`, `scripts/e2e-smoke.js`) — Dan approves the commit | The uncommitted vercel.json sets `buildCommand: node scripts/check-i18n.mjs` while `website/scripts/` is untracked. Committed apart, **every future Vercel deploy fails at build**. e2e-smoke.js is referenced by root `package.json` `test:e2e` (verified passing locally today, en/es/ko). | ☐ |
| A3 | Commit the 3 `eas.json` env lines (held poster-language flags) — they are on the **dev-apk-ai-studio profile only** (verified absent from production/apk) | Ends the dirty-file ambiguity; inert for production builds. If Dan prefers, stashing is acceptable — but decide, don't leave it dirty. | ☐ |
| A4 | Wire `node scripts/check-i18n-defaultvalue-gaps.mjs` into `.github/workflows/ci.yml` (next to `check:i18n-keys`) | The guard that catches the "53 English strings shown to es/ko users" class exists and is committed but NOT enforced — the class regresses silently without it. (Approval Queue #3, second half, from the QA plan.) | ☐ |
| A5 | Add the untracked plan docs (`poster-item-language-mismatch-plan-2026-07-23.md`, `wallet-pass-go-live-runbook-2026-07-23.md`, this file) to the same or a docs commit | Trackers should ride the repo; they're referenced by device QA below. | ☐ |

## Phase B — Client fixes that must ride THIS rebuild (Opus, ~half day)

These are all rebuild-gated: skip them now and they wait for the next store release.

| # | Task | Detail / acceptance | Status |
|---|------|---------------------|--------|
| B1 | **Delete-account reachability for business accounts with no approved application** (F-3 from the sign-in QA — P1 here) | The published privacy policy says "You can start account deletion inside the app under Account or Settings", and Apple guideline 5.1.1(v) requires it — but a business-role account with no approved application currently has **no path to delete-account at all** (device-verified 2026-07-25; Dan had to delete the test user from the dashboard). Investigate the no-application business landing state and give it a working path to Account → Delete (localized en/es/ko). Acceptance: a business user with (a) no application and (b) a pending application can complete in-app deletion; shopper path unchanged; tests added. | ☐ |
| B2 | F-10 remaining raw-error paths | `app/redemption-mode.tsx:252`, `app/(tabs)/redeem.tsx:163`, `lib/auth-error-messages.ts:79` — route through `translateKnownApiMessage` so es/ko users never see raw English errors. One-liners per the QA audit. | ☐ |
| B3 | F-08 business-apply double-submit | Keep the submit button disabled through the redirect; map the 429 response to a localized message. | ☐ |
| B4 | F-09 "Release deal" confirmation | Wrap the single-tap forfeit in `useBrandedConfirm` (never `Alert.alert`). **Dan decision** — default = add it (a forfeit is not always re-claimable: sold-out / daily-cap). | ☐ decision + ☐ fix |
| B5 | (Optional — LOCKED FILE) F-16 es/ko revision label | en "Revision {{number}}" vs es "Ajuste" / ko "수정" — es/ko merchants can't tell revisions apart. The copy renders from `app/create/ai.tsx`, which **is covered by the AI poster lock** → needs Dan's per-file approval first; then fix + regenerate lock hash + chain `latestApprovalRef`. Skip cleanly if not approved. | ☐ |
| B6 | F-12 un-stale the website readiness gate | Update the 3 stale assertions in `scripts/check-website-supabase-readiness.js` (iOS store URL now live, `tryGetServiceRoleKey()` helper, current `?v=` values) so `check:website-supabase` is green **before** the Phase E deploy — a permanently red gate is how real regressions slip through. | ☐ |

## Phase C — Console/dashboard checks (DAN, ~30 min, before the builds)

None of these are code; every one is a launch-day failure mode if wrong.

| # | Check | What good looks like | Status |
|---|-------|----------------------|--------|
| C1 | **Supabase → Authentication → Providers → Google → Client IDs** | Contains BOTH client IDs, comma-separated: the web client ID AND the iOS client ID. iOS tokens carry the iOS client ID as audience — **if only the web ID is listed, Android keeps working and iOS Google sign-in fails with an audience error.** Cannot be checked from the CLI (sign-in plan Phase 4 box, still unchecked). | ☐ |
| C2 | **Supabase → Authentication → Rate Limits → email send** (currently **30/hour**) + your **Resend plan** | Raise to ≥200/hour for launch week (confirmation emails are the signup gate). Resend free tier is 100 emails/day — if you're on free, upgrade or day-1 signups stall mid-afternoon. | ☐ |
| C3 | **Stripe Dashboard → Webhooks → prod endpoint → subscribed events** | Must include every type the deployed handler processes: `charge.dispute.created`, `charge.refunded`, `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created/updated/deleted`, `customer.updated`, `invoice.paid`, `invoice.payment_failed`. The dispute handler shipped later than the endpoint was configured — if the event isn't subscribed, chargeback auto-suspension silently never fires. | ☐ |
| C4 | **Stranded-merchant census** (F-21 residual) — run in SQL editor:<br>`SELECT b.id, b.name, b.status, a.status AS application_status FROM businesses b JOIN business_applications a ON a.business_id = b.id WHERE b.status IN ('trialing','active','limited_trial') AND a.status NOT IN ('approved_not_activated','approved');` | Zero rows, or approve each returned application. **Standing operational rule:** approve → merchant signs in once → THEN comp/activate (first sign-in stamps the claim permanently). | ☐ |
| C5 | **AI spend headroom** | OpenAI prepaid balance topped up; Gemini quota OK; default cap is **30 AI generations per business per month** (`AI_MONTHLY_LIMIT` function env) — decide if that fits launch merchants, raise via secret if not. | ☐ |
| C6 | **EAS credentials sanity** (should all be no-ops since 1.0.0 shipped) | iOS: APNs key + distribution cert present in EAS. Android: keystore unchanged. `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` EAS secret still set (F-14: confirmed working on the live 1.0.0 build). | ☐ |
| C7 | **Reviewer demo account** still signs in (App Review notes reference it) | Demo credentials work on prod; demo deals render. | ☐ |

## Phase D — Build + staged verification (DAN-gated; agent assists with checklists)

Do NOT go straight from `eas build` to public release. The staging path below is the only place Apple sign-in, Google-on-iOS, and the Play-store-signed Google flow can be proven.

| # | Step | Notes | Status |
|---|------|-------|--------|
| D1 | EAS production builds (iOS + Android AAB) from `qa/poster-ad-quality` after Phases A–B land | `autoIncrement` handles build numbers (remote: iOS 27→28, Android 57→58). `expo.version` stays 1.0.1 (already bumped; `gate:release-state` green today). | ☐ |
| D2 | **Android:** upload AAB to Play **internal testing** track; install on the S10 **from Play** | This is the only build signed with the **Play App Signing** key — the known prod-only breakage mode for Google sign-in. Sideloaded/EAS-signed builds cannot prove this. | ☐ |
| D3 | **iOS: TestFlight matrix on Dan's iPhone** | Apple sign-in as shopper · Apple sign-in with **Hide My Email** as shopper (works) · Hide My Email attempting **business** (guard fires → local sign-out → retry path works) · Google sign-in both roles · email/password unchanged · **delete account** · core loop (browse → claim → redeem QR) · push received (favorite a business, publish from the S10). | ☐ |
| D4 | **S10 device matrix** (the deferred Phase-4 subset of the rare-feature QA plan) | D1 lifecycle incl. on-device delete · D3 favorites→publish→push routing · D5 create paths (edited headline survives publish; schedule cannot invert; AI cooldown countdown) · D6 redemption edge (repeat-restricted hides after redeem; redeemed toast; redemption-mode enter/exit) · D10 permission-denial matrix · spot-check ~10 new es/ko strings (F-05) + demo-offer copy in Spanish (F-17) · K9 spot-checks (logo upload, poster text edit, favorites dropdown, sort pills, QR live watch, site import). Record PASS/FAIL per line here. | ☐ |
| D5 | Store metadata for the new sign-in providers | App Privacy (iOS) + Data Safety (Play) updated for Google/Apple auth; App Review notes keep the demo account; release notes written. | ☐ |

## Phase E — Website + release (DAN-gated)

| # | Step | Notes | Status |
|---|------|-------|--------|
| E1 | Privacy policy: add Google sign-in and Sign in with Apple as login providers (en/es/ko via website i18n), bump `?v=`, follow `docs/website-edit-checklist.md` | Today the policy doesn't mention either provider; store reviewers and the data-safety forms will point at it. | ☐ |
| E2 | **Deploy the website** (gated) | Ships E1 AND the committed-but-not-live **admin comp-grant UI** (`90f41f46`) — without this deploy you cannot comp merchants from the console on launch day. After deploy: `E2E_BASE_URL=https://www.twoferapp.com npm run test:e2e` + `npm run check:website-supabase` (green after B6). | ☐ |
| E3 | Release: submit iOS 1.0.1 with **phased release ON**; promote the Play AAB with **staged rollout** (20% → 100%) | iOS review typically 1–2 days — schedule the public/marketing push only after BOTH stores are live, not the same day you submit. | ☐ |
| E4 | Day-1 monitoring cadence (no crash SDK on board — decision recorded below) | 2×/day minimum: Play Console vitals + App Store crash reports; Supabase Edge Function logs (any 5xx) + Auth logs (rate-limit hits); Resend delivery dashboard (bounces/suppressions); Stripe events; admin AI-spend panel; support@twoferapp.com inbox. | ☐ |

## Post-launch queue (deliberately NOT blocking launch)

- Staged RLS migrations, apply with probes after each: F-13 `terms_acceptances` owner arm (SQL ready, QA plan Approval Queue #5) · F-19 `business_locations` owner-read (Approval Queue #8).
- F-22 narrow retry around `auth.admin.deleteUser` in delete-user-account (deploy-gated).
- F-04 timing-safe CRON_SECRET compare (deploy-gated).
- K8 military-brand image-gen re-test (now unblocked; costs 1 generation of quota).
- F-11 polish set (analytics timezone label, silent expired reset link, consumer-setup escape hatch, unchecked logo follow-up write).
- Android edge case: unconfirmed-password-account + Google sign-in (needs a fixture account).
- Crash reporting (Sentry) in 1.0.2 — adding a native module days before launch is worse than launching without.
- Native-speaker skim of the AI-produced es/ko translations (F-05 note).
- Merge `qa/poster-ad-quality` → `main` when Dan wants (approval-gated; main currently differs only by one docs commit).

## Decisions Dan must make explicitly

| # | Decision | Default recommendation |
|---|----------|------------------------|
| 1 | **Demo/QA content on day 1:** real shoppers will see demo deals in the feed (now correctly localized), and "The Colonel's Brew" QA business exists in prod. Keep as feed-filler while real merchants ramp, or hide? | Keep demo deals (empty feed is worse), retire QA-business leftovers. |
| 2 | F-09: confirm-before-release-deal | Yes, add it (B4). |
| 3 | F-16 locked-file approval for the es/ko revision label | Approve (small, real es/ko UX gap). |
| 4 | Launch without crash reporting | Accept for 1.0.1; add Sentry in 1.0.2; compensate with E4 cadence. |
| 5 | AI monthly cap (30/business) sizing for launch merchants | Keep 30 unless you expect heavy generators; it's an env change later. |

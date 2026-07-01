# Twofer App Store Readiness Current-State Report

Date: 2026-06-30

Update 2026-07-01: this report is now a historical baseline. The mobile Stripe/IAP blocker, website deployment, business-intake migration/function deployment, hosted function smoke, and RLS smoke are superseded by `APP_STORE_SUBMISSION_IMPLEMENTATION_REPORT.md` and `APP_STORE_REVIEW_GAP_MATRIX.md`. Remaining current blockers are App Store Connect setup, exact TestFlight/release build verification, reviewer demo data, real-device smoke, legal/privacy review, and `gettwofer.com` redirects.

## Executive Summary

- Overall status: Not ready for public App Store submission.
- Recommended path: submit as a consumer-first or invite-only merchant pilot only after the iOS billing posture is resolved, reviewer accounts/data are verified, App Store metadata/screenshots are finalized, and hosted Supabase migration/function state is confirmed.
- Highest-confidence completed items: iOS bundle/app config exists, email/password auth exists, in-app account deletion exists, location has ZIP fallback, push is opt-in, QR/claim/redeem is server-backed, privacy manifest exists, and privacy/store copy drafts exist.
- Main uncertainty: the exact TestFlight build and hosted Supabase state were not verified from App Store Connect or Supabase Dashboard.

## Top 5 Blockers

1. Merchant billing/IAP risk: `app/(tabs)/account/billing.tsx` opens Stripe Checkout through `stripe-create-checkout-session`, `PAID_BILLING_ENABLED=true`, and there is no StoreKit/RevenueCat implementation. Apple Guideline 3.1.1 says app feature unlocks must use in-app purchase, with limited exceptions. Current classification: High rejection risk unless disabled/hidden for iOS review, implemented with StoreKit, or clearly outside in-app digital unlocking.
2. App Store Connect state unknown: final build, review notes, demo accounts, privacy nutrition label, screenshots, age rating, export compliance, and subscription/IAP entries cannot be verified locally.
3. Reviewer live-deal path not verified today: repo has Cedar/demo QA migrations and notes, but hosted data and reviewer accounts must be checked manually so reviewers can see a claimable deal outside Dallas.
4. Hosted backend state unknown: 99 local migrations and many Edge Functions exist, but this audit did not run `supabase migration list`, deploy functions, or query production.
5. Spanish/Korean broad rollout not approved: `eas.json` production enables several localization flags, but `docs/localization/native-review-log.md` still has TBD Spanish/Korean reviewers and pending screenshot QA.

## Top 5 Risks

1. Current working tree is dirty: `android/app/build.gradle`, `app.json`, and untracked `s10-live-publish-qa/`. Current repo may not match the last TestFlight build.
2. `app.json` Android `versionCode` is 38, while `AGENTS.md` says 31 and recent git history mentions 33. Code/config wins, but the docs are stale.
3. Production config includes a Supabase hosted deal-link intent filter and environment-loaded public Supabase values; App Store review must use the intended hosted backend.
4. Store screenshot assets are scattered across local QA folders; no clearly final App Store screenshot package was found.
5. UGC/AI moderation is partial: reports exist, AI guardrails exist, but no dedicated pre-publication moderation/admin takedown console was verified.

## Recommended Submission Path

Do not submit the current code posture as a paid merchant subscription app on iOS. Safest choices:

1. Hide/disable merchant billing and external Stripe checkout for the iOS review build, then submit as consumer plus invite-only merchant pilot.
2. Or implement StoreKit auto-renewable subscription for merchant plans and submit the first subscription with the app version.
3. Or delay public App Store submission until Dan chooses the billing model and verifies hosted backend/demo data.

## Current Build State

- Branch: `feature/ai-deal-studio-dev-foundation`
- Commit: `c6e10585`
- Recent commits: latest is `Expand localized offer term dictionaries`; recent history includes `Bump Android version code to 33`.
- Uncommitted changes before report writing: `android/app/build.gradle`, `app.json`, untracked `s10-live-publish-qa/`.
- App version: `1.0.0` in `package.json` and `app.json`.
- iOS bundle identifier: `com.unvmex2.twoforone`.
- iOS build number: not set in local `app.json`; EAS/App Store Connect build number must be verified manually.
- Android versionCode in code: 38.
- Expo SDK/runtime: Expo SDK 54, React Native 0.81.5, React 19.1.0. `npx expo config --type public` reported SDK `54.0.0`.
- EAS profile likely used for App Store/TestFlight: `production` in `eas.json`; exact submitted TestFlight build unknown.
- TestFlight match status: Unknown. App Store Connect access was not available.

## What Already Looks Complete

- Email/password auth and hard role split are present in app code and docs.
- In-app account deletion exists for consumers and business owners:
  - `app/(tabs)/settings.tsx`
  - `app/(tabs)/account/index.tsx`
  - `supabase/functions/delete-user-account/index.ts`
- Legal/support defaults are wired:
  - `lib/legal-urls.ts`
  - `lib/support-contact.ts`
- Location permission copy and ZIP fallback exist:
  - `app.json`
  - `app/onboarding.tsx`
  - `lib/us-zip-geocode.ts`
- Push notifications are opt-in and token storage is consent-gated:
  - `lib/push-token.ts`
  - `lib/notifications.ts`
  - `supabase/functions/send-deal-push/index.ts`
- Claim, QR, and redemption are Edge-backed:
  - `supabase/functions/claim-deal/index.ts`
  - `supabase/functions/redeem-token/index.ts`
  - `supabase/functions/_shared/claim-redeem.ts`
- Reports for business/customer issues exist:
  - `components/report-sheet.tsx`
  - `lib/reports.ts`
  - `supabase/migrations/20260705130000_reports.sql`
- Store copy and App Store answer drafts exist:
  - `docs/app-store-copy-20260607.md`
  - `docs/app-store-connect-answer-sheets-20260607.md`

## What Is Missing

- Verified App Store Connect metadata, screenshots, review notes, demo credentials, and privacy answers.
- Verified TestFlight build number and whether it matches commit `c6e10585`.
- StoreKit/IAP implementation for merchant paid plans, if the iOS app will sell/unlock merchant functionality.
- A confirmed reviewer-friendly live/claimable deal path in the hosted review environment.
- Final legal review of privacy, terms, merchant terms, acceptable use, refunds/cancellation, and AI content language.
- Hosted Supabase migration/function parity check.
- iOS real-device TestFlight smoke for the full consumer and merchant flows.

## What Is Risky

- Billing: high App Review risk while Stripe Checkout can be launched from the iOS app for a merchant feature unlock.
- Localization: production flags and broad rollout approval docs conflict. Code paths exist, but reviewer signoff remains pending.
- UGC/AI: report tools exist, but pre-publication moderation/takedown operations are not fully evidenced.
- Store screenshots: local screenshots exist, but many are QA/dev artifacts and not clearly App Store-ready.
- Backend deployment: local code has many migrations/functions; hosted state is not proven.

## Evidence Reviewed

Files inspected:

- `AGENTS.md`
- `package.json`
- `app.json`
- `app.config.js`
- `eas.json`
- `docs/release-audit/current-state.md`
- `docs/deployment-notes.md`
- `docs/production-deploy-checklist.md`
- `docs/deployment-command-plan.md`
- `docs/ai-ad-current-state.md`
- `docs/app-store-copy-20260607.md`
- `docs/app-store-connect-answer-sheets-20260607.md`
- `docs/localization/multilingual-deals-production-approval-runbook.md`
- `docs/localization/native-review-log.md`
- `docs/beta-release-checklist.md`
- app account/settings/onboarding/billing/deal/redeem screens
- Supabase claim/redeem/delete/push/report/billing functions and migrations

Commands run:

- `git status --short`
- `git branch --show-current`
- `git rev-parse --short HEAD`
- `git log --oneline -10`
- `npm install --dry-run`
- `npm run lint --if-present`
- `npm run typecheck --if-present`
- `npx tsc --noEmit`
- `npx expo-doctor`
- `npx expo config --type public`
- production-profile `npx expo config --type public`
- targeted `rg` searches for auth deletion, location, push, billing, AI/content, QR, demo/review, legal, screenshots, RLS/security

Tests/checks run:

- TypeScript: passed.
- Lint: passed.
- Expo Doctor: 18/18 checks passed.
- `npm install --dry-run`: completed, showing dependency changes that npm would make if installed.
- `npm test`: passed after report creation (201 test files, 1082 tests).

Screens tested:

- No live iOS or Android device flow was tested in this audit.
- Existing QA screenshots and release notes were reviewed as historical evidence only.

Apple sources used:

- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Submitting apps: https://developer.apple.com/app-store/submitting/
- App privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Submit an app: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/
- Submit in-app purchases/subscriptions: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/

## App Store Submission Recommendation

- Submit now? No.
- Minimum tasks before submission:
  1. Decide iOS merchant billing path.
  2. Verify or disable Stripe checkout in the exact iOS review build.
  3. Verify the selected TestFlight build, build number, and commit.
  4. Verify hosted Supabase migrations/functions/secrets by name only.
  5. Verify reviewer consumer and merchant accounts and a claimable seeded deal.
  6. Upload final screenshots and metadata in App Store Connect.
  7. Complete privacy nutrition label based on the exact build.

## Next 7-Day Action Plan

1. Day 1: choose billing path: iOS billing hidden/invite-only, StoreKit, or delay.
2. Day 2: create a clean release candidate branch/commit once current local changes are reviewed.
3. Day 3: verify hosted Supabase migration list, Edge Function list, and required secret names without exposing values.
4. Day 4: create/verify reviewer accounts and a seeded claimable Dallas/Grapevine demo path.
5. Day 5: run iOS TestFlight real-device smoke for consumer, merchant, delete-account, QR, and push opt-in.
6. Day 6: prepare final App Store screenshots/metadata/privacy answers.
7. Day 7: final release checklist review and submit only after Dan approves.

## Optional Fix PRs Recommended

### PR 1: Resolve iOS billing posture

- Scope: hide/disable in-app Stripe checkout for iOS review or replace with StoreKit.
- Files: `app/(tabs)/account/billing.tsx`, `lib/billing/access.ts`, billing Edge Function docs/tests, App Store copy/docs.
- Risk: high, because payment behavior affects App Review and merchant access.
- Validation: typecheck, lint, tests, production-profile Expo config, iOS TestFlight smoke.

### PR 2: Reviewer demo path

- Scope: dedicated reviewer accounts, one claimable demo deal, clear review notes, and no secret leakage.
- Files: docs plus seed/runbook only unless app copy needs small changes.
- Risk: medium.
- Validation: real-device TestFlight consumer claim, Wallet QR, merchant redeem, dashboard update.

### PR 3: Store/legal finalization

- Scope: final privacy/terms/support/delete-account URLs, merchant/refund/acceptable-use language, App Privacy answers.
- Files: docs and website/store materials.
- Risk: medium.
- Validation: open all URLs, compare App Store privacy answers to `app.json`, dependencies, and backend tables.

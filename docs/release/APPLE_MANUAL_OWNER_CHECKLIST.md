# Apple Manual Owner Checklist

Last updated: 2026-07-01 by Codex after a read-only repo audit, public URL checks, and read-only Supabase function listing. No App Store Connect submission, release build, website deploy, Supabase mutation, secret read, or reviewer credential handling was performed.

Status legend:

- [x] Verified from repo, public hosted URLs, or read-only CLI output.
- [ ] Requires Dan, App Store Connect, real-device QA, authenticated reviewer smoke, or production-console access.

## Current Evidence Notes

- Source bundle ID is `com.unvmex2.twoforone` in `app.json`.
- Source app version is `1.0.0` in `app.json`.
- Current source Android `versionCode` is `39` in `app.json` and `android/app/build.gradle`. Older docs still mention `31` or `38`; code wins, and the exact Apple build number still must be verified in TestFlight/App Store Connect.
- Apple's current SDK upload gate says that since 2026-04-28, App Store Connect uploads must use Xcode 26 or later with an iOS 26-family SDK: https://developer.apple.com/news/upcoming-requirements/?id=02032026a
- Public URL checks were run on 2026-07-01 with `curl.exe`. `www.twoferapp.com` routes returned HTTP 200. `www.gettwofer.com` did not resolve, and `gettwofer.com` timed out.
- Remote Supabase function deployment was checked read-only against project `kvodhiqhdqnptqovovia` with `npx supabase functions list --project-ref kvodhiqhdqnptqovovia`.

## App Store Connect

- [ ] Verify Apple Developer account is active. Owner-only in Apple Developer/App Store Connect.
- [x] Confirm source bundle ID: `com.unvmex2.twoforone`.
- [ ] Confirm App Store Connect bundle ID matches `com.unvmex2.twoforone`.
- [ ] Confirm app version and selected build number match the intended TestFlight build. Source version is `1.0.0`; App Store Connect build number was not accessible from this audit.
- [ ] Confirm the uploaded build uses the current Apple SDK requirement: Xcode 26 or later with an iOS 26-family SDK.
- [ ] Upload final iPhone screenshots from the final TestFlight/release-candidate build. Use `docs/release/APP_STORE_SCREENSHOT_PLAN.md`.
- [ ] Enter metadata from `docs/release/APP_STORE_METADATA_DRAFT.md`.
- [ ] Enter privacy labels from `docs/release/APP_PRIVACY_DISCLOSURE_DRAFT.md` after legal review against the exact submitted build and hosted backend.
- [ ] Enter age rating. Draft recommendation is 13+ in `docs/release/APP_STORE_METADATA_DRAFT.md`.
- [x] Verify support URL is live: `https://www.twoferapp.com/support`.
- [ ] Set App Store Connect support URL: `https://www.twoferapp.com/support`.
- [x] Verify privacy URL is live: `https://www.twoferapp.com/privacy`.
- [ ] Set App Store Connect privacy URL: `https://www.twoferapp.com/privacy`.
- [ ] Paste review notes with real credentials only in App Store Connect. Use `docs/release/APPLE_REVIEW_NOTES_DRAFT.md`; do not put passwords in repo or chat.
- [ ] Confirm app pricing is free for consumers in App Store Connect.
- [ ] Confirm no in-app purchases are submitted for launch in App Store Connect. Code posture is no mobile checkout/pricing/IAP for launch, but App Store Connect was not checked.
- [ ] Choose manual or automatic release.
- [ ] Submit for review.
- [ ] Monitor App Review messages.

## Website / Domains

- [x] Deploy `website/` to `https://www.twoferapp.com`.
- [x] Verify `https://www.twoferapp.com/delete-account` is live and linked from support/privacy.
- [x] Review live privacy, terms, business terms, support, and delete-account pages for launch-posture consistency.
- [ ] Redirect `https://www.gettwofer.com` to `https://www.twoferapp.com`. Current check: DNS did not resolve.
- [ ] Redirect `https://gettwofer.com` to `https://www.twoferapp.com`. Current check: request timed out.
- [x] Replace `TEAMID` in `website/.well-known/apple-app-site-association`; current file uses `L9DT756YSN.com.unvmex2.twoforone`.
- [x] Add Android Play App Signing SHA-256 to `website/.well-known/assetlinks.json`.
- [x] Verify live `/.well-known/apple-app-site-association` returns HTTP 200.
- [x] Verify live `/.well-known/assetlinks.json` returns HTTP 200.
- [x] Verify `/business`, `/business/thanks`, `/support`, `/privacy`, `/terms`, `/business-terms`, `/delete-account`, and `/s/` load with HTTP 200.

## Supabase / Backend

- [x] Apply `20260730123000_business_applications.sql` after approval.
- [x] Deploy `submit-business-application` after approval.
- [x] Submit one non-sensitive production business-application smoke test.
- [x] Verify hosted Edge functions are deployed for account deletion, claim/redeem, AI, push, analytics intake, billing status, and business intake.
  - Observed `ACTIVE`: `delete-user-account`, `claim-deal`, `redeem-token`, `begin-visual-redeem`, `complete-visual-redeem`, `cancel-visual-redeem`, `finalize-stale-redeems`, `release-claim`, `ai-generate-ad-variants`, `ai-compose-offer`, `ai-generate-deal-copy`, `ai-create-deal`, `ai-extract-menu`, `ai-business-lookup`, `ai-deal-suggestions`, `ai-translate-deal`, `send-deal-push`, `ingest-analytics-event`, `billing-pricing`, and `submit-business-application`.
- [ ] Run authenticated hosted reporting smoke for the `report_business` and `report_user` Supabase RPCs. Reporting is RPC-backed in this repo, not a dedicated Edge Function.
- [ ] Run hosted account deletion smoke with disposable consumer and business-owner accounts.
- [ ] Run hosted reviewer-path smoke: consumer claim -> wallet QR/code -> merchant redeem -> dashboard update.
- [ ] Verify reviewer merchant entitlement is active and requires no payment flow. Allowed active statuses are `trial_active`, `admin_trial_active`, `trial_canceling`, `pro_active`, `pro_canceling`, `paid_active`, or `paid_canceling`.
- [x] No secrets, auth tokens, push tokens, QR tokens, claim codes, redemption codes, API keys, certificates, provisioning profiles, or reviewer passwords were exposed during this checklist pass.

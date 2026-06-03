# TWOFER Beta Release Checklist

Use this before every beta APK or production-like internal release. The goal is a repeatable report Dan can read without translating build tooling notes.

Never paste secret values into this file, tickets, chat, screenshots, or release notes. Secret checks are by name only.

## Release Report Template

Copy this section into the release handoff and fill in the blanks.

### 1. Release Metadata

- Release date:
- Final commit SHA:
- Branch:
- EAS profile:
- Android versionCode:
- EAS build URL:
- Tester / device:

### 2. Git And EAS Context

- [ ] `git status --short --untracked-files=all` is clean.
- [ ] `git ls-files --others --exclude-standard` prints nothing, or every listed file is intentionally excluded from the EAS build context.
- [ ] No diagnostics, screenshots, local exports, `.env` files, APKs, AABs, `.codex/`, `project-knowledge/`, or `claude-history-export/` are included in the release context.
- Result:

Commands:

```bash
git rev-parse --short HEAD
git status --short --untracked-files=all
git ls-files --others --exclude-standard
```

### 3. Demo UI Production Check

- [ ] Production EAS profile does not set `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER`.
- [ ] Production EAS profile does not set `EXPO_PUBLIC_SHOW_DEBUG_PANEL`.
- [ ] Production EAS profile does not set `EXPO_PUBLIC_DEBUG_BOOT_LOG`.
- [ ] Production EAS profile does not set `EXPO_PUBLIC_PREVIEW_MATCHES_DEV`.
- [ ] Auth screen in the production APK does not show demo credentials or demo-login helper UI.
- [ ] Any demo-only AI copy appears only for the real demo account or preview/dev builds.
- Result:

Commands:

```bash
rg -n "EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER|EXPO_PUBLIC_SHOW_DEBUG_PANEL|EXPO_PUBLIC_DEBUG_BOOT_LOG|EXPO_PUBLIC_PREVIEW_MATCHES_DEV|Demo|demo" app components hooks lib constants eas.json app.config.js app.json
npx eas-cli build:version:get -p android --profile production --non-interactive
```

### 4. Static Validation

- [ ] Typecheck passed: `npm run typecheck`
- [ ] Lint passed: `npm run lint`
- [ ] Vitest passed: `npm test`
- Result:

### 5. Expo Start Rule

- [ ] `npx expo start` was not run because this release candidate only changed docs/tooling, or:
- [ ] `npx expo start` was run because runtime app behavior changed and a manual UI check was required.
- Result:

### 6. Android Smoke

Run on a production-like APK for the same versionCode in this report, not on a stale emulator build.

- [ ] Cold start reaches auth without crash.
- [ ] Sign in / sign up works.
- [ ] Consumer home feed loads.
- [ ] Shops list opens, shop detail opens, and back navigation works.
- [ ] Wallet opens.
- [ ] Business setup opens for a business user.
- [ ] Create deal flow rejects a weak deal with friendly guidance.
- [ ] Create deal flow publishes a strong TWOFER/BOGO deal.
- [ ] Claim -> wallet -> redeem smoke passes.
- [ ] Business dashboard reflects claim/redeem activity.
- [ ] No raw Supabase, RLS, internal ID, or stack-trace text is visible.
- Result:

### 7. Supabase Migrations

- [ ] `npx supabase migration list` shows every local migration applied remotely.
- [ ] Last expected migration:
- [ ] No migration drift or failed remote migration is visible.
- Result:

### 8. Supabase Secrets By Name Only

Run `npx supabase secrets list` only when authenticated with Supabase. Record names only, never values.

Core names to verify:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_PLACES_API_KEY`
- `CRON_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` or `STRIPE_WEBHOOK_SIGNING_SECRET`

Optional or tuning names seen in source:

- `OPENAI_MODEL`
- `OPENAI_WHISPER_MODEL`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_IMAGE_MODEL_DEFAULT`
- `OPENAI_IMAGE_MODEL_GENERATE`
- `OPENAI_IMAGE_MODEL_EDIT`
- `OPENAI_IMAGE_EDIT_MODEL`
- `AI_ADS_DEMO_USE_LIVE`
- `AI_COMPOSE_PROMPT_VERSION`
- `AI_COOLDOWN_SECONDS`
- `AI_COPY_MONTHLY_LIMIT`
- `AI_DEDUP_WINDOW_SECONDS`
- `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY`
- `AI_INSIGHTS_MONTHLY_LIMIT`
- `AI_MONTHLY_LIMIT`
- `BILLING_SIMULATE_SUBSCRIBE`

Production expectations:

- `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY` is absent or false.
- `BILLING_SIMULATE_SUBSCRIBE` is absent or false.
- `AI_ADS_DEMO_USE_LIVE` is a deliberate pilot decision if present.
- Result:

### 9. Digest Cron And Vault Secret

- [ ] `weekly-deal-digest` function is deployed.
- [ ] Migration `20260708150000_weekly_digest_cron.sql` is applied remotely.
- [ ] Vault secret exists by name only: `weekly_digest_cron_secret`.
- [ ] `public.verify_weekly_digest_secret(text)` exists and is executable by `service_role`.
- [ ] `public.weekly_digest_cron_status()` returns active job `weekly-deal-digest`.
- [ ] Schedule is expected: Saturdays at 17:00 UTC.
- [ ] Dry run succeeds without sending pushes, if available.
- Result:

Do not select from `vault.decrypted_secrets` in a report. For status, use:

```sql
select * from public.weekly_digest_cron_status();
```

### 10. VersionCode And Build URL

- [ ] Android versionCode:
- [ ] EAS build URL:
- [ ] Installed test APK versionCode matches the report versionCode.
- Result:

Commands:

```bash
npx eas-cli build:version:get -p android --profile production --non-interactive
adb shell dumpsys package com.unvmex2.twoforone | Select-String -Pattern "versionCode|versionName|firstInstallTime|lastUpdateTime"
```

### 11. Known Issues

List issues that testers and Dan need to know before inviting cafes.

- Issue:
- User impact:
- Workaround:
- Owner / next step:

## Current Run - 2026-06-03

Checklist executed against the current beta candidate at commit `ec621fb` (the commit that added this checklist), branch `fix/production-clean-copy`.

### 1. Release Metadata

- Release date: 2026-06-03
- Final commit SHA: `ec621fba43dcf0440ac3c9f41449b6be52863e6d` (`ec621fb`)
- Branch: `fix/production-clean-copy`
- EAS profile checked: `production`
- Android versionCode from EAS: `9`
- EAS build URL: not created in this task (no build was started)
- APK used for smoke: `C:\Users\unvme\Downloads\twoforone\application-e0d34c3b-102e-498d-b81b-45ebd0b59ea8.apk`
- Tester / device: Android emulator `emulator-5554`; installed app is `versionCode=9`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 18:23:21`

### 2. Git And EAS Context

Result: Passed for committed files; local ignored smoke artifacts are present.

- Earlier static release checks ran from a clean tree before Task 11 report edits.
- Current working tree contains only the Task 11 report edits plus ignored local smoke artifacts.
- Ignored local artifacts used in this smoke run include `application-e0d34c3b-102e-498d-b81b-45ebd0b59ea8.apk` and `qa-screens/task-11-release-smoke/`; do not commit them and remove or confirm EAS ignores them before starting a new release build.

### 3. Demo UI Production Check

Result: Static check passed; production APK UI smoke failed on ANR/data/layout coverage below.

- `eas.json` sets `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER`, `EXPO_PUBLIC_SHOW_DEBUG_PANEL`, `EXPO_PUBLIC_DEBUG_BOOT_LOG`, and `EXPO_PUBLIC_PREVIEW_MATCHES_DEV` only in the `development` and `preview` profiles; the `production` profile sets none of them.
- The production EAS environment loaded only these public variable names: `EXPO_PUBLIC_DELETE_ACCOUNT_URL`, `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPPORT_URL`, `EXPO_PUBLIC_TERMS_OF_SERVICE_URL`. No demo/debug public flags were present.
- Earlier production auth captures on the installed versionCode `9` APK did not show demo credential helper UI after relaunch. The fresh follow-up cold launch preserved the signed-in demo business session, so signed-out auth was not revalidated in this pass.

### 4. Static Validation

Result: Passed.

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test` passed: 23 files, 171 tests.

### 5. Expo Start Rule

Result: Not run.

- `npx expo start` was not started because this candidate changed documentation/release reporting only; no runtime app behavior changed.

### 6. Android Smoke

Result: Failed / partially completed on current versionCode `9` APK.

- `adb devices` showed emulator `emulator-5554` online.
- Local current APK exists: `application-e0d34c3b-102e-498d-b81b-45ebd0b59ea8.apk`.
- `aapt dump badging` confirmed package `com.unvmex2.twoforone`, `versionCode=9`, `versionName=1.0.0`.
- Reinstalled with `adb install -r` and launched with `adb shell monkey -p com.unvmex2.twoforone -c android.intent.category.LAUNCHER 1`.
- Installed package after reinstall: `versionCode=9`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 18:23:21`.
- Fresh screenshot capture worked in this follow-up. New current-run screenshots captured under `qa-screens/task-11-release-smoke/`: `01-cold-launch.png`, `08-current-business-create.png`, `09-current-business-redeem.png`, `10-current-business-my-offers.png`, `11-current-business-billing.png`, `12-current-business-account.png`, `13-current-customer-home.png`, `14-current-customer-shops.png`, `15-current-shop-detail.png`, `16-current-shop-detail-deal-section.png`, `17-current-back-to-shops.png`, `18-current-map-tab.png`, and `21-current-anr-dialog.png`.
- Cold launch after reinstall preserved the signed-in demo business session and opened the business Create hub.
- Business Create, merchant Redeem, My offers/dashboard, Billing, and business Account loaded without raw error text.
- Business Account showed `demo@demo.com`, the business/customer mode control, and demo-named business profile data. Switching to customer mode worked.
- Customer Home loaded a friendly no-live-deals state; no raw Supabase/RLS/stack text was visible.
- Shops loaded two businesses and shop detail opened/back navigation worked.
- Shop detail for a no-live-deal business showed the no-live-deal empty state, but still displayed "Use this deal" / "Scan QR at counter" redemption guidance underneath. That is a missing-data layout problem.
- Customer Map loaded Google map tiles and pins, then Android showed a `TWOFER isn't responding` ANR dialog. Screenshot: `21-current-anr-dialog.png`.
- Wallet and Settings were not verified in the fresh follow-up because the Map ANR blocked the pass before those tabs could be reached.
- Claim -> wallet -> QR/redeem could not be completed because no live deal / active wallet ticket was reachable before the Map ANR.
- Production data still includes demo-named business/deal surfaces because the tested account/business is demo data.

### 7. Supabase Migrations

Result: Passed.

- `npx supabase migration list` showed every local migration with a matching remote entry (no drift).
- Last migration applied remotely: `20260708150000_weekly_digest_cron`.

### 8. Supabase Secrets By Name Only

Result: Blocked for remote listing.

- `npx supabase secrets list` returned "Access token not provided" because this shell has no `supabase login` session / `SUPABASE_ACCESS_TOKEN`. (Migration list works via the linked database; secrets need a Management API token.)
- No secret values were read or printed. Verify the section 8 names from an authenticated shell before the release build.

### 9. Digest Cron And Vault Secret

Result: Partially passed.

- Migration `20260708150000_weekly_digest_cron` is applied remotely (see section 7).
- That migration provisions Vault secret name `weekly_digest_cron_secret`, RPC `verify_weekly_digest_secret`, status RPC `weekly_digest_cron_status`, and cron job `weekly-deal-digest` (expected schedule: Saturdays 17:00 UTC).
- Live cron status was not queried in this run. Confirm from an authenticated SQL session with `select * from public.weekly_digest_cron_status();`.

### 10. VersionCode And Build URL

Result: Passed for versionCode match; no build URL created.

- `npx eas-cli build:version:get -p android --profile production --non-interactive` returned Android versionCode `9` (advanced from `8` in the prior recorded run; the `production` profile uses `autoIncrement: true`).
- No build was started, so there is no new EAS build URL to report.
- Installed emulator APK matches the report versionCode: `versionCode=9`, `versionName=1.0.0`.

### 11. Known Issues

- Android smoke FAILED on the current versionCode `9` APK: the customer Map tab raised a visible `TWOFER isn't responding` ANR after the map loaded, blocking Wallet, Settings, and claim/redeem coverage in the fresh follow-up.
- No live deal / active wallet ticket was reachable for claim -> wallet -> QR/redeem coverage before the Map ANR.
- Shop detail shows redemption guidance under a no-live-deal empty state.
- Fresh screenshots captured successfully in this follow-up; keep the current-run screenshots listed in section 6 and ignore earlier black-frame notes from the prior attempt.
- Production data still has demo-named businesses/deals on the tested account. Confirm whether this is acceptable only for the demo account before inviting external testers.
- Supabase secret names could not be verified remotely without Supabase CLI auth; verify names only before the release build.
- Signed-out production auth was not revalidated in the fresh follow-up because `adb install -r` preserved the logged-in demo session.
- Live digest cron status (`weekly_digest_cron_status()`) has not been queried for this run.
- Final EAS build URL must be pasted into the release report after the beta APK is built.

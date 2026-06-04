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

## Current Run - 2026-06-03 Final RC Smoke

Final Android release-candidate smoke was executed against the fresh local APK in the TWOFER folder. This pass used Claude Code via `claude -p` for APK install, launch, navigation, and screenshot capture.

### 1. Release Metadata

- Release date: 2026-06-03 local smoke run
- Final commit SHA: `3504faa06eca69f1d6662be1b7df93ba7737d431` (`3504faa`)
- Branch: `fix/production-clean-copy`
- EAS profile checked: not rechecked in this smoke-only pass
- Android versionCode from APK: `10`
- EAS build URL: not available from the local APK folder metadata
- APK used for smoke: `C:\Users\unvme\Downloads\twoforone\application-b6700649-9ac5-4227-8fd8-6089d3746ed7.apk`
- Screenshots folder: `qa-screens/final-rc-smoke/`
- Tester / device: Android emulator `emulator-5554`; installed app is `versionCode=10`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 21:09:06`

### 2. Git And EAS Context

Result: Passed for source tree before report edits; local ignored smoke artifacts are present.

- `git status --short --untracked-files=all` was clean before updating this report.
- Ignored local artifacts used in this smoke run include the APK and `qa-screens/final-rc-smoke/`; do not commit screenshots or APKs.
- Full EAS context checks were not repeated because the requested scope was final Android APK smoke only.

### 3. Demo UI Production Check

Result: Passed for the production APK UI surfaces inspected.

- Signed-out auth landing was captured in `signed_out_auth_landing.png`.
- The auth screen did not show demo credential helper UI or a demo-login helper button.
- Login succeeded through the normal email/password form using the locally documented seeded demo account; no password values are recorded here.
- Demo-named business/account data appears after login because the tested account is the seeded demo account.

### 4. Static Validation

Result: Not rerun in this pass.

- No app code was modified during final RC smoke.
- This task updated only release documentation after the device smoke.

### 5. Expo Start Rule

Result: Not run.

- `npx expo start` was not started. The smoke test used the installed production-like APK on Android.

### 6. Android Smoke

Result: Passed with data-limited claim and redeem coverage on current versionCode `10` APK.

- Newest APK found in the TWOFER folder: `application-b6700649-9ac5-4227-8fd8-6089d3746ed7.apk`.
- `aapt dump badging` confirmed package `com.unvmex2.twoforone`, `versionCode=10`, `versionName=1.0.0`.
- Claude Code recovered `emulator-5554`, installed the APK with `adb install -r`, and launched TWOFER.
- Installed package after reinstall matched the APK: `versionCode=10`, `versionName=1.0.0`.
- Screens passed: signed-out auth landing, login, consumer Home deals, Shops, shop detail/back navigation, Map, Map 30-second wait, Map pins/toggles, Wallet, Settings, business mode switch, merchant Redeem manual Ticket code screen, business dashboard/My offers, Create deal hub, Billing, and business Account.
- Consumer onboarding was not shown because the returning demo account was already onboarded.
- Wallet opened and showed no active deals plus expired tickets. QR/pass could not be opened because there was no active ticket.
- Claim -> wallet -> QR/pass -> merchant redeem could not be fully tested because the account had no active live deal or active wallet ticket.
- Prior Map ANR result: fixed for this APK. Map stayed responsive after loading Google tiles and pins, after a 30-second wait, and after pin/toggle interaction. Recent logcat checks did not show a `com.unvmex2.twoforone` ANR or fatal exception.
- No crashes, ANRs, raw Supabase/RLS errors, stack traces, demo helper UI, black screens, broken navigation, or release-blocking missing-data layout problems were observed.
- Screenshots captured under `qa-screens/final-rc-smoke/`: `signed_out_auth_landing.png`, `completed_login.png`, `04_home_deals.png`, `05_shops_tab.png`, `06_shop_detail.png`, `07_map_tab.png`, `07b_map_30s.png`, `07c_map_pin_tap.png`, `07d_map_livedeals.png`, `08_wallet.png`, `09_merchant_redeem.png`, `redeem_ticket_code.png`, `10_business_mode_switch.png`, `11_business_dashboard.png`, `13_create_deal_hub.png`, `billing_tab.png`, `12_settings.png`, `12b_settings_scrolled.png`, `12c_settings_scrolled2.png`, and `business_account_tab.png`.

### 7. Supabase Migrations

Result: Not rerun in this pass.

- Final RC smoke did not query migration state; use the template section above for release-build validation.

### 8. Supabase Secrets By Name Only

Result: Not rerun in this pass.

- No secret values were read or printed.
- Verify secret names only from an authenticated shell before the external beta release if this has not been done for the final build.

### 9. Digest Cron And Vault Secret

Result: Not rerun in this pass.

- Live cron/vault status was outside the requested final Android smoke scope.

### 10. VersionCode And Build URL

Result: Passed for versionCode match; build URL still needs release handoff value.

- APK versionCode: `10`
- Installed emulator versionCode: `10`
- APK versionName: `1.0.0`
- Installed emulator versionName: `1.0.0`
- EAS build URL: not available from the local APK folder metadata.

### 11. Known Issues

- Claim -> wallet -> QR/pass -> merchant redeem was not fully tested because the demo account has no active live deal or active wallet ticket. Seed/create active claim data before final money-flow proof.
- Billing UI shows "Free trial active" on the Twofer Pro card while "Current plan" is highlighted on Twofer Premium. Confirm whether this reflects the actual seeded subscription state.
- Business Account shows demo profile values `Met` / `E` under "Your Coffee Shop". This appears to be demo profile/seed data, but should be cleaned up if the demo account will be shown to non-engineering testers.
- Demo-named businesses/deals are visible because the seeded demo account was used for smoke.
- Final EAS build URL must be pasted into the release report once the beta APK's build record is available.

## Current Run - 2026-06-03 Final Money-Flow Validation

Focused validation was run against the installed versionCode `10` APK to close the prior claim/redeem data gap. This pass used Claude Code via `claude -p` for scoped data/setup reconnaissance, then used the current APK on Android emulator `emulator-5554` for the app flow.

### 1. Release Metadata

- Release date: 2026-06-03 local device run
- Final commit SHA: not changed for app code in this validation pass
- Branch: `fix/production-clean-copy`
- EAS profile checked: not rechecked in this money-flow-only pass
- Android versionCode from installed APK: `10`
- APK used: `C:\Users\unvme\Downloads\twoforone\application-b6700649-9ac5-4227-8fd8-6089d3746ed7.apk`
- Screenshots folder: `qa-screens/final-money-flow/`
- Tester / device: Android emulator `emulator-5554`; installed app reports `versionCode=10`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 21:09:06`

### 2. Data Setup

Result: Passed for creating a claimable money-flow test deal without service-role writes.

- Preferred reset path `npm run seed:demo` was identified, but this shell did not have `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`; no service-role secret was read or printed.
- Used the existing demo account with the normal Supabase anon client/RLS path.
- Verified the demo business had no active owned deals and no active unredeemed claims.
- Inserted one strong live deal under `Demo Roasted Bean Coffee`: `2-for-1 Latte Pair`, price `$6.50`, max claims `25`, active through `2026-06-11T02:54:02.823Z`.
- The remote schema cache did not expose optional `deals.location_id`, so the row was inserted without that field.

### 3. Android Smoke

Result: Failed / blocked at merchant manual redeem.

- Consumer Home displayed the seeded live deal.
- Claim Deal succeeded and opened an active QR modal with claim code `BH2 4NS`.
- After app relaunch, Home showed the deal as `Claimed`.
- Wallet showed the active ticket for `2-for-1 Latte Pair`, code `BH2 4NS`, and redeem-by timing.
- Business dashboard showed `Claims: 1` for the live deal.
- Merchant Redeem manual Ticket code screen accepted `BH24NS`, reached the deployed `redeem-token` function, and failed with visible raw copy: `Edge Function returned a non-2xx status code`.
- Direct signed-in function probe with the same short code returned HTTP 500 with body: `Failed to redeem token: new row for relation "deal_claims" violates check constraint "deal_claims_redeem_method_check"`.
- The claim remained active and unredeemed after the failed attempt.

### 4. Screenshots Captured

Screenshots captured under `qa-screens/final-money-flow/`:

- `00_initial_state_step.png`
- `01_home_live_deal_seeded_step.png`
- `02_claim_cta_visible_step.png`
- `03_after_claim_blank_or_transition_step.png`
- `04_after_hide_qr_state_step.png`
- `05_hide_retry_state_step.png`
- `06_back_after_qr_state_step.png`
- `07_after_adb_hide_visible_step.png`
- `08_wallet_active_ticket_step.png`
- `09_business_dashboard_claim_count_step.png`
- `10_merchant_ticket_code_entry_step.png`
- `11_merchant_redeem_failed_raw_error_step.png`

### 5. Known Issues

- Claim -> Wallet -> QR evidence passed, but merchant manual redeem did not pass on the current backend/database state.
- Backend blocker: deployed `redeem-token` writes `redeem_method = "short_code"` for manual code redemption, while the database `deal_claims_redeem_method_check` constraint rejects that value.
- User-facing blocker: the APK surfaces the raw `Edge Function returned a non-2xx status code` message on merchant redeem failure.
- Wallet `Use deal` and `Show QR & code` controls appeared enabled but did not respond to MCP or raw adb taps in this run after Wallet was opened; rerun after the backend redeem fix to confirm whether this is automation-only or a Wallet interaction defect.

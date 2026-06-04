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

## Current Run - 2026-06-04 Final Money-Flow Retest

Focused retest was run against the already-installed versionCode `10` APK after the `redeem-token` backend fix was deployed. This pass used Claude Code via `claude -p` for scoped retest confirmation, then used the installed APK on Android emulator `emulator-5554` for the app flow.

### 1. Release Metadata

- Release date: 2026-06-04 local retest run
- Final commit SHA: not changed for app code in this validation pass
- Branch: `fix/production-clean-copy`
- EAS profile checked: not rechecked in this money-flow-only pass
- Android versionCode from installed APK: `10`
- Android versionName from installed APK: `1.0.0`
- APK used: existing installed `C:\Users\unvme\Downloads\twoforone\application-b6700649-9ac5-4227-8fd8-6089d3746ed7.apk`; no reinstall was needed
- Screenshots folder: `qa-screens/final-money-flow-retest/`
- Tester / device: Android emulator `emulator-5554`; installed app reports `versionCode=10`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 21:09:06`
- Backend function tested: `redeem-token`

### 2. Data Setup

Result: Passed for creating a fresh claimable live deal and fresh active claim using the normal anon/RLS path.

- No service-role secret was read or printed.
- Used the existing demo account through normal Supabase anon/RLS.
- Marked one stale unredeemed demo claim from the prior failed run as `canceled` so a fresh same-business claim could be created.
- Inserted one fresh strong live deal under `Demo Roasted Bean Coffee`: `BOGO: 2-for-1 Cold Brew Pair 20260604034035`, price `$5.75`, max claims `25`, active through `2026-06-11T03:40:35.739Z`.
- The installed APK created the fresh active claim; Wallet showed claim code `8RT XUC`.

### 3. Android Smoke

Result: Passed.

- Fresh deal detail opened in the installed APK and showed `Claims remaining: 25 / 25`.
- Tapping `Claim` created a backend active claim with code `8RT XUC`, but the deal-detail screen stayed on `Claiming...` until app relaunch.
- Wallet after relaunch showed the active ticket, QR area, and code `8RT XUC`.
- The dedicated Wallet `Show QR & code` button still did not open a modal via MCP/raw tap, but the Wallet card rendered the QR/code evidence needed for staff manual redeem.
- Business dashboard before redeem showed the fresh deal with `Claims 1`, `Redeemed 0`.
- Merchant Redeem manual Ticket code accepted `8RTXUC` and passed against deployed `redeem-token`; the app showed the branded `Redeemed` receipt.
- Direct backend verification showed the fresh claim as `claim_status = redeemed`, `redeem_method = qr`, with non-null `redeemed_at`.
- Consumer Wallet after redeem showed no active deals, `Deals redeemed: 1`, `$5.75` estimated savings, and the fresh ticket under Ended deals as `Redeemed by staff scan`.
- Business dashboard after a fresh load showed global `Redemptions: 1`; the fresh deal row showed `Claims 1`, `Redeemed 1`, `Redeem rate 100%`.

### 4. Screenshots Captured

Screenshots captured under `qa-screens/final-money-flow-retest/`:

- `00_stale_previous_redeem_error.png`
- `01_relaunch_consumer_home.png`
- `02_fresh_deal_detail_claim_cta.png`
- `03_fresh_deal_claim_cta_visible.png`
- `04_after_claim_detail_still_claiming.png`
- `05_claim_still_waiting_or_result.png`
- `06_relaunch_after_claim.png`
- `07_wallet_active_ticket_qr_code.png`
- `08_wallet_active_ticket_buttons.png`
- `09_show_qr_code_tap_result.png`
- `10_business_mode_relaunch.png`
- `11_settings_switch_to_business_visible.png`
- `12_business_dashboard_pre_redeem_claim_count.png`
- `13_merchant_ticket_code_entered.png`
- `14_merchant_redeem_success.png`
- `15_wallet_redeemed_state.png`
- `16_business_dashboard_after_redeem_relaunch.png`
- `17_business_dashboard_after_redeem_count.png`

### 5. Known Issues

- The prior manual redeem backend blocker is resolved for the deployed `redeem-token` function on the existing versionCode `10` APK.
- Follow up separately on the deal-detail post-claim loading state; the claim was created, but the detail screen stayed on `Claiming...` until relaunch.
- Follow up separately on the Wallet `Show QR & code` backup button hit/open behavior; Wallet still rendered the active ticket QR area and claim code, so manual redeem was not blocked.
- The improved client-side fallback copy for failed `redeem-token` responses still requires a new APK to validate, as expected from the backend-fix follow-up.

## Current Run - 2026-06-04 Final Owner-Demo Smoke

Final owner-demo smoke was executed against the newest local APK in the TWOFER folder. This pass used `claude -p` for scoped reconnaissance, then Codex completed the APK install, Android smoke, screenshot capture, and release documentation directly.

### 1. Release Metadata

- Release date: 2026-06-04 local owner-demo smoke run
- Final commit SHA: not changed for app code in this validation pass
- Branch: `fix/production-clean-copy`
- EAS profile checked: not rechecked in this smoke-only pass
- Android versionCode from APK: `11`
- Android versionName from APK: `1.0.0`
- Package from APK: `com.unvmex2.twoforone`
- EAS build URL: not available from the local APK folder metadata
- APK used: `C:\Users\unvme\Downloads\twoforone\application-11538fb6-92fc-469f-8fe9-5d41e82433e0.apk`
- Screenshots folder: `qa-screens/final-owner-demo-smoke/`
- Tester / device: Android emulator `emulator-5554`; installed app reports `versionCode=11`, `versionName=1.0.0`, `lastUpdateTime=2026-06-04 15:56:02`

### 2. APK Verification And Install

Result: Passed for APK metadata, install, launch, and installed version match.

- Newest APK in `C:\Users\unvme\Downloads\twoforone`: `application-11538fb6-92fc-469f-8fe9-5d41e82433e0.apk`, modified 2026-06-04 15:44:19 local time.
- `aapt dump badging` confirmed package `com.unvmex2.twoforone`, `versionCode=11`, `versionName=1.0.0`.
- Installed on `emulator-5554` with `adb install -r`.
- `adb shell dumpsys package com.unvmex2.twoforone` confirmed the installed package matched `versionCode=11`, `versionName=1.0.0`.
- App data was cleared before launch to validate the signed-out first-run path.

### 3. Owner Demo Smoke

Result: Failed - not ready to show real business owners.

- Passed: signed-out auth landing opened with TWOFER branding and no demo credential helper UI.
- Passed: login through the normal email/password form.
- Passed: business mode opened; create deal hub, business dashboard, Billing, Account/Settings, and merchant manual Ticket code screen were reachable.
- Passed: Billing recent fix is included. The Pro card says `Included in Premium`, and Premium is the only card that says `Current plan`.
- Passed: merchant manual redeem screen accepted a ticket code and showed a branded `Redeemed` success receipt.
- Failed: business dashboard still showed `Welcome back, Demo Roasted Bean Coffee`.
- Failed: Account still showed stale profile data including `Your Coffee Shop`, `Met`, and `E`.
- Failed: business dashboard deal titles still included timestamped smoke-test copy such as `BOGO: 2-for-1 Cold Brew Pair 20260604034035`.
- Failed: hosted demo data did not show `Cedar & Bean Cafe` or another polished merchant-demo business where expected.
- Failed: the in-session business dashboard did not refresh redemption counts immediately after merchant manual redeem; it refreshed after force-stop/relaunch.

### 4. Consumer Proof Path

Result: Failed with QR modal and demo-data blockers, though the fresh claim and manual redeem money flow completed.

- Passed: consumer onboarding, Home, Shops, shop detail, Wallet, and Settings were reachable.
- Passed: a fresh live deal could be claimed, and the deal detail opened the QR/code modal instead of staying stuck on `Claiming...`.
- Passed: Wallet showed the active ticket and later showed redeemed state after merchant manual redeem.
- Passed: merchant manual redeem completed successfully for the fresh claimed code.
- Failed: claim QR/code modal `Hide` did not dismiss reliably, and Android Back did not close the modal in this run.
- Failed: Wallet QR/code panel did not open the QR/code modal.
- Failed: Wallet `Show QR & code` button did not open the QR/code modal.
- Failed: after Wallet QR/code button attempts, bottom-tab navigation stopped responding until app relaunch.
- Failed: consumer-facing demo data still included `Demo Roasted Bean Coffee`, `My Coffee`, address `124`, preview-tester description copy, stale favorite shops, and timestamped deal titles.
- Failed: the live deal claim CTA was partially clipped near the bottom tab bar before a slight scroll.
- Failed: Android Back from shop detail did not return to Shops, though the visible navigate-up control worked.

### 5. Map Responsiveness

Result: Passed.

- Map opened with Google tiles and a marker.
- Map remained responsive after a 30-second wait.
- Live-deals filter interaction stayed responsive after the wait.
- Logcat check during the 30-second wait did not show a `com.unvmex2.twoforone` ANR, fatal exception, or `Application Not Responding` entry.

### 6. Screenshots Captured

Screenshots captured under `qa-screens/final-owner-demo-smoke/`:

- `01_signed_out_auth_landing.png`
- `02_business_create_hub_after_login.png`
- `03_business_dashboard_tour.png`
- `04_business_dashboard_stale_demo_data_FAIL.png`
- `05_billing_premium_copy_PASS.png`
- `06_account_stale_met_e_FAIL.png`
- `07_merchant_manual_ticket_code.png`
- `08_consumer_onboarding.png`
- `09_consumer_onboarding_stale_shops_FAIL.png`
- `10_home_no_live_stale_favorite_FAIL.png`
- `11_home_all_deals_stale_claimed_FAIL.png`
- `12_live_deal_timestamp_claim_button_partially_clipped_FAIL.png`
- `13_claim_success_qr_modal_PASS.png`
- `14_claim_qr_hide_back_nonresponsive_FAIL.png`
- `15_wallet_active_ticket_stale_data.png`
- `16_wallet_qr_panel_tap_no_modal_FAIL.png`
- `17_wallet_show_qr_button_no_modal_FAIL.png`
- `18_shops_list_stale_junk_FAIL.png`
- `19_shop_detail_stale_preview_copy_FAIL.png`
- `20_map_initial.png`
- `21_map_after_30s.png`
- `22_map_live_filter_after_30s.png`
- `23_merchant_manual_redeem_success.png`
- `24_dashboard_after_redeem_stale_count_FAIL.png`
- `25_dashboard_after_relaunch_redemptions_updated.png`
- `26_wallet_redeemed_state_stale_data.png`

### 7. Static Validation

Result: Not rerun.

- No app code was modified during this final owner-demo smoke.
- Per the task instruction, `npm run typecheck` and `npm run lint` were not rerun.
- This pass updated only `TASK_QUEUE.md` and `docs/beta-release-checklist.md` after device validation.

### 8. Known Issues And Readiness

- Owner-demo readiness: No. This APK should not be shown to real business owners yet.
- Release blockers: stale hosted demo data, Wallet QR/code modal controls not opening, claim QR/code modal dismiss/back failure, and in-session dashboard redemption count not refreshing after redeem.
- First-impression issues: stale/junk business names and profile fields, timestamped deal names, preview-tester shop copy, clipped claim CTA, clipped Settings mode-switch button, and broken Android Back from shop detail.
- Non-blocking pass: Map responsiveness appears fixed in this APK for the tested 30-second scenario.
- Screenshots and APKs are local release artifacts and should not be committed.

## Current Run - 2026-06-04 Hosted Demo Data Refresh

Focused hosted data refresh was run after the versionCode `11` owner-demo smoke found stale remote demo data. No service-role secret was available in the shell, so this pass used only the normal demo account anon/RLS path and did not print any secret values.

### 1. Environment And Command

Result: Partially passed.

- Shell env check showed `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_ANON_KEY` were not present.
- `npm run seed:demo` was not run because the required service-role env was missing.
- Used the local public Expo Supabase env values for a signed-in demo account anon/RLS refresh; no service-role key was used.
- Command run: inline Node anon/RLS hosted refresh using `@supabase/supabase-js`, the documented demo account, and the same Cedar & Bean Cafe data from the seed files.

### 2. Hosted Data Result

Result: Demo-owned data fixed; one unowned public stale row remains.

- Fixed: demo-owned `businesses` row now shows `Cedar & Bean Cafe`, `Maya Patel`, `hello@cedarbean.cafe`, `120 S Main St`, `Grapevine, TX`, polished hours, category, and description.
- Fixed: demo-owned `business_profiles` row now shows `Cedar & Bean Cafe`, `120 S Main St`, `Cafe & Bakery`; existing `active` / `premium` billing state was preserved.
- Fixed: demo-owned deal rows now show professional titles: `Buy One Latte, Get One Free`, `2-for-1 Pastry Pair Before Noon`, `BOGO Iced Tea Launch Special`, `Weekday Cold Brew 2-for-1`, and `Saturday Bakery Box BOGO`.
- Fixed: read-only stale deal title scan found no `BOGO: 2-for-1 Cold Brew Pair ...`, `2-for-1 Latte Pair`, `BOGO Coffee Special!`, or old seed deal titles.
- Still blocked: public stale business `My Coffee`, address/location `124`, contact `Demo Owner`, `hello@demo.twofer.app`, id prefix `a0000000`, remains visible and is not owned by the demo account under RLS.
- A tightly constrained anon/RLS delete attempt for that exact `My Coffee` / `124` row returned zero deletable rows.

### 3. Manual Admin Cleanup Needed

Run this in Supabase SQL Editor with admin/service-role privileges, then rerun `npm run seed:demo` if a full service-role refresh is desired:

```sql
DELETE FROM public.businesses
WHERE id = 'a0000000-0000-4000-8000-00000000c0de'
  AND name = 'My Coffee'
  AND address = '124'
  AND business_email = 'hello@demo.twofer.app';
```

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
npm run seed:demo
```

### 4. Readiness

- Owner-demo readiness from data alone: Not fully ready until the unowned `My Coffee` / `124` public row is removed.
- Demo-owned business/account/deal data: Ready for Cedar & Bean Cafe verification.
- Other versionCode `11` blockers from the smoke remain separate: Wallet QR/code modal controls, claim QR dismiss/back behavior, in-session dashboard redemption refresh, clipped claim CTA, clipped Settings mode switch, and Android Back from shop detail.

## Current Run - 2026-06-04 Hosted Demo Data Cleanup Verification

Focused read-only verification was run after the admin SQL removal of the stale unowned `My Coffee` row. `claude -p` was available and was attempted first for the narrow verification, but it timed out after 184 seconds without returning findings, so Codex completed the check directly.

### 1. Scope And Method

Result: Passed.

- Used only public anon/RLS reads plus the normal demo account anon session.
- No service-role key was used.
- No secret values, API keys, passwords, or `.env` contents were printed.
- `npx expo start`, typecheck, and lint were not run because no app/source code changed.

### 2. Hosted Data Result

Result: Passed - hosted owner-demo data is clean.

- Unauthenticated public Shops-visible `businesses` scan found zero stale matches across 2 visible rows.
- Authenticated public Shops-visible `businesses` scan found zero stale matches across 2 visible rows.
- Authenticated Home-visible/public `deals` scan found zero stale matches across 5 visible rows.
- Demo-owned `businesses` row shows `Cedar & Bean Cafe`, `Maya Patel`, `hello@cedarbean.cafe`, `120 S Main St`, and `Grapevine`.
- Demo-owned `business_profiles` row shows `Cedar & Bean Cafe`, `120 S Main St`, and `Cafe & Bakery`.
- Demo-owned deal rows show professional titles: `Buy One Latte, Get One Free`, `2-for-1 Pastry Pair Before Noon`, `BOGO Iced Tea Launch Special`, `Weekday Cold Brew 2-for-1`, and `Saturday Bakery Box BOGO`.
- Public Shops/Home data no longer shows `My Coffee`, address `124`, `Demo Roasted Bean Coffee`, `Met`, `E`, timestamped smoke-test deal names, or preview-tester copy.

### 3. Readiness

- Owner-demo readiness from hosted data alone: Yes.
- Stale hosted demo data is no longer a release blocker.
- Other versionCode `11` runtime/UI blockers from the owner-demo smoke remain separate: Wallet QR/code modal controls, claim QR dismiss/back behavior, in-session dashboard redemption refresh, clipped claim CTA, clipped Settings mode switch, and Android Back from shop detail.

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

### 1. Release Metadata

- Release date: 2026-06-03
- Current commit SHA: `1ee7eaf`
- Branch: `fix/production-clean-copy`
- EAS profile checked: `production`
- Android versionCode from EAS: `8`
- EAS build URL: not created in this task
- Tester / device: Android emulator `emulator-5554`; installed app was stale `versionCode=1`

### 2. Git And EAS Context

Result: Passed.

- `git status --short --untracked-files=all` printed no changes.
- `git ls-files --others --exclude-standard` printed no untracked files.
- `.easignore` is absent, so the release context should rely on Git / `.gitignore` defaults unless EAS is configured differently.

### 3. Demo UI Production Check

Result: Static check passed; production APK UI smoke still needed.

- `eas.json` enables demo/debug flags only in `development` and `preview`.
- The production EAS environment loaded these public variable names: `EXPO_PUBLIC_DELETE_ACCOUNT_URL`, `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPPORT_URL`, `EXPO_PUBLIC_TERMS_OF_SERVICE_URL`.
- The production EAS environment output did not list demo/debug public flags.
- Source still contains demo-account paths and strings, but the production check found them tied to runtime gating or real demo-account handling. Verify the production APK auth screen before inviting testers.

### 4. Static Validation

Result: Passed.

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test` passed: 23 files, 171 tests.

### 5. Expo Start Rule

Result: Not run.

- `npx expo start` was not started because Task 11 changed only documentation and release reporting.

### 6. Android Smoke

Result: Not run for the current beta candidate.

- `adb devices` showed emulator `emulator-5554`.
- `com.unvmex2.twoforone` is installed, but it is `versionCode=1` from 2026-04-07.
- Current EAS production Android versionCode is `8`, so smoke-testing the installed app would not validate this candidate.

### 7. Supabase Migrations

Result: Passed.

- `npx supabase migration list` showed all 63 local migrations with matching remote entries.
- Last remote migration listed: `20260708150000_weekly_digest_cron`.

### 8. Supabase Secrets By Name Only

Result: Blocked for actual remote secret listing.

- `npx supabase secrets list` could not run because this shell is not authenticated with `supabase login` / `SUPABASE_ACCESS_TOKEN`.
- Source env-name inventory was captured by name only; no values were read or reported.

### 9. Digest Cron And Vault Secret

Result: Partially passed.

- Migration `20260708150000_weekly_digest_cron.sql` is present locally and listed as applied remotely.
- The migration creates Vault secret name `weekly_digest_cron_secret`, RPC `verify_weekly_digest_secret`, status RPC `weekly_digest_cron_status`, and cron job `weekly-deal-digest`.
- Active cron status was not queried in this run; verify with `select * from public.weekly_digest_cron_status();`.

### 10. VersionCode And Build URL

Result: Partially passed.

- `npx eas-cli build:version:get -p android --profile production --non-interactive` returned Android versionCode `8`.
- No build was started, so there is no new build URL to report.
- Installed emulator APK is stale at versionCode `1`; install the versionCode `8` APK before Android smoke.

### 11. Known Issues

- Android smoke is pending for the current beta candidate because no versionCode `8` APK was installed during this docs-only task.
- Supabase secrets could not be listed without Supabase CLI authentication; verify names only before the release build.
- Production APK auth screen still needs a visual confirmation that no demo credentials/helper UI appears.
- Final EAS build URL must be pasted into the release report after the beta APK is built.

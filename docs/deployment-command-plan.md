# TWOFER deployment command plan

Command-by-command verification for moving from code readiness to **deployment readiness**. This doc does not deploy anything by itself.

**Related:** [production-deploy-checklist.md](./production-deploy-checklist.md), [deployment-notes.md](./deployment-notes.md), [release-candidate-status.md](./release-candidate-status.md), [pilot-smoke-test-checklist.md](./pilot-smoke-test-checklist.md).

**Legend**

- **READ-ONLY** — Does not change hosted Supabase data, Edge deployments, or EAS cloud builds. (May still read local files or prompt for session.)
- **LOCAL-ONLY** — Updates local Supabase CLI link state under `.supabase/`; does not run SQL on production by itself.
- **PRODUCTION-CHANGING** — Mutates hosted DB schema/data, Edge Function code on Supabase, secrets, or triggers EAS builds.

---

## 1. Supabase project verification

| Step | Command | Classification | Notes |
|------|---------|----------------|-------|
| List accessible projects | `npx supabase projects list` | READ-ONLY | Uses your Supabase login; lists refs and names. |
| Link this repo to a hosted project | `npx supabase link --project-ref <YOUR_PROJECT_REF>` | LOCAL-ONLY | Stores link locally; may prompt for DB password. Does **not** apply migrations. |
| Local stack status (mostly dev) | `npx supabase status` | READ-ONLY (local) | Useful when Docker/local Supabase is running. For hosted truth, use Dashboard or `migration list`. |
| Compare local migration files vs remote history | `npx supabase migration list` | READ-ONLY (remote reads) | Requires `link`. Shows which migrations are applied remotely vs present locally. See [Supabase CLI: migration list](https://supabase.com/docs/reference/cli/supabase-migration-list). |
| Apply pending migrations to linked remote | `npx supabase db push` | **PRODUCTION-CHANGING** | Run **only** after explicit human approval and after `migration list` review. Re-run `migration list` after. |

**Also PRODUCTION-CHANGING (do not run casually):**

- `npx supabase migration repair` (fixes migration history; easy to get wrong)
- Ad-hoc SQL in Dashboard without a tracked migration
- `npx supabase secrets set ...` (sets secret values on the project)

**Comparing local files to remote:** Use Section 2 (ordered filename list) plus `migration list` output and Dashboard **Database → Migrations**.

---

## 2. Supabase migrations

### 2.1 Full local set (58 files, strict filename / timestamp order)

Apply order is **lexicographic sort of the full filename** (standard Supabase CLI behavior).

1. `20250127000000_initial_schema.sql`
2. `20260127000001_add_deal_templates_and_recurring.sql`
3. `20260128120000_business_profile_ai_context.sql`
4. `20260129100000_deal_quality_tier.sql`
5. `20260130120000_business_preferred_locale.sql`
6. `20260323120000_users_read_claimed_deals.sql`
7. `20260324120000_business_coordinates.sql`
8. `20260324180000_business_consumer_profile_fields.sql`
9. `20260325120000_ai_generation_logs.sql`
10. `20260325120100_ai_compose_quota_rpc.sql`
11. `20260325183000_strong_deal_only_guardrail.sql`
12. `20260326120000_consumer_profiles_business_contact.sql`
13. `20260326210000_deal_claims_short_code.sql`
14. `20260327120000_launch_visual_redeem_analytics.sql`
15. `20260328140000_merchant_insights_rpc.sql`
16. `20260330120000_fix_deal_claims_deals_rls_recursion.sql`
17. `20260330140000_deals_public_read_start_time_deal_templates_timezone.sql`
18. `20260331120000_deal_poster_storage_public_read.sql`
19. `20260401120000_add_claim_blocked_reason_mix_to_merchant_business_insights.sql`
20. `20260401150000_update_strong_deal_guardrail_free_item.sql`
21. `20260402120000_push_tokens.sql`
22. `20260402130000_server_set_quality_tier.sql`
23. `20260403120000_consumer_push_prefs.sql`
24. `20260404120000_app_analytics_events_select_business_owner.sql`
25. `20260429120000_business_menu_items.sql`
26. `20260502120000_profiles_app_tab_mode.sql`
27. `20260530120000_business_locations_deal_location.sql`
28. `20260601000000_create_business_profiles.sql`
29. `20260601153000_billing_v4_app_config_and_subscription_rls.sql`
30. `20260601160000_create_subscription_history.sql`
31. `20260630120000_lockdown_deal_claims_client_insert.sql`
32. `20260630123000_enforce_business_locations_cap_insert_rls.sql`
33. `20260701120001_enable_rate_limits_rls.sql`
34. `20260701120002_enable_app_config_rls_backend_only.sql`
35. `20260701130000_fix_deal_claims_rls_recursion_billing_v4.sql`
36. `20260702120000_deal_translation_columns.sql`
37. `20260703120000_add_analytics_business_id_index.sql`
38. `20260703120001_push_token_cleanup.sql`
39. `20260703120002_birthdate_check_constraint.sql`
40. `20260703120003_deal_claims_status_changed_at.sql`
41. `20260703120004_timezone_validation.sql`
42. `20260703120005_claim_race_guards.sql`
43. `20260704120000_business_logo_storage.sql`
44. `20260704120000_enable_deals_realtime.sql`
45. `20260704130000_enforce_max_claims_atomic.sql`
46. `20260705120000_businesses_pii_column_grants.sql`
47. `20260705120002_deal_claims_unique_active.sql`
48. `20260705120003_subscription_history_idempotency.sql`
49. `20260705120004_deal_claims_dashboard_index.sql`
50. `20260705120005_business_profiles_single_row.sql`
51. `20260705120006_realtime_publication_insert_only.sql`
52. `20260705120007_failed_redeem_attempts.sql`
53. `20260705120008_purge_user_data_rpc.sql`
54. `20260705120009_push_token_cleanup_schedule.sql`
55. `20260705130000_reports.sql`
56. `20260706120000_business_invite_gate.sql`
57. `20260706130000_deal_photo_owner_upload_policies.sql`
58. `20260707120000_business_menu_item_sizes.sql`

### 2.2 Latest migration

**`20260707120000_business_menu_item_sizes.sql`**

### 2.3 Duplicate timestamp warning

Two files share the prefix **`20260704120000`**:

- `20260704120000_business_logo_storage.sql` (runs **first** — `business_` before `enable_` lexicographically)
- `20260704120000_enable_deals_realtime.sql`

Order is stable but duplicate prefixes are an operational footgun; prefer unique timestamps for new migrations.

### 2.4 Command to apply migrations (do not run without explicit approval)

```bash
npx supabase link --project-ref <YOUR_PROJECT_REF>   # if not already linked
npx supabase migration list                          # READ-ONLY: verify pending
npx supabase db push                                 # PRODUCTION-CHANGING
npx supabase migration list                          # confirm all applied
```

---

## 3. Supabase storage

### 3.1 Buckets that should exist

| Bucket | Source migrations | Public read |
|--------|-------------------|-------------|
| `deal-photos` | `20260331120000_deal_poster_storage_public_read.sql`, `20260706130000_deal_photo_owner_upload_policies.sql` | Yes (`public = true`, public SELECT policy) |
| `business-logos` | `20260704120000_business_logo_storage.sql` | Yes (`public = true`, public SELECT policy) |

### 3.2 Dashboard checks

- **Storage → Buckets:** `deal-photos` and `business-logos` exist and are **public**.
- **`deal-photos` object paths:** App uses `deal-photos/<business_id>/<filename>`. RLS for INSERT/UPDATE/DELETE requires the first path segment to match a business owned by `auth.uid()`.
- **`business-logos`:** Policies allow authenticated INSERT/UPDATE; public SELECT for all objects in bucket.

### 3.3 SQL spot-checks (read-only in SQL editor)

```sql
-- Buckets
SELECT id, name, public FROM storage.buckets WHERE id IN ('deal-photos', 'business-logos');

-- Policy names present (adjust if you rename)
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (
    policyname ILIKE '%deal%' OR policyname ILIKE '%business%logo%'
  );
```

### 3.4 Smoke tests (manual)

See [production-deploy-checklist.md §2](./production-deploy-checklist.md): owner uploads logo; owner uploads deal photo; consumer or logged-out read of public URLs behaves as expected.

---

## 4. Edge Functions

### 4.1 Functions to deploy (repo inventory)

All of the following exist under `supabase/functions/` and have `[functions.<name>]` entries in `supabase/config.toml` (each with `verify_jwt = false` — callers must pass auth headers where required; Stripe webhook uses signature verification).

| Function |
|----------|
| `ai-business-lookup` |
| `ai-compose-offer` |
| `ai-create-deal` |
| `ai-deal-suggestions` |
| `ai-extract-menu` |
| `ai-generate-ad-variants` |
| `ai-generate-deal-copy` |
| `ai-translate-deal` |
| `begin-visual-redeem` |
| `billing-checkout-redirect` |
| `billing-pricing` |
| `cancel-visual-redeem` |
| `claim-deal` |
| `complete-visual-redeem` |
| `deal-link` |
| `delete-user-account` |
| `finalize-stale-redeems` |
| `ingest-analytics-event` |
| `redeem-token` |
| `send-deal-push` |
| `simulate-subscribe` |
| `stripe-create-checkout-session` |
| `stripe-customer-portal-session` |
| `stripe-webhook` |

**Note:** `docs/deployment-notes.md` may mention `ai-refine-ad-copy`; that folder is **not** in this repo. Deploy only what exists above.

**Shared code:** `supabase/functions/_shared/` is bundled with functions; redeploy functions after changing `_shared/`.

### 4.2 Pilot-critical subset (non-exhaustive)

- **Wallet / redeem:** `claim-deal`, `redeem-token`, `begin-visual-redeem`, `complete-visual-redeem`, `finalize-stale-redeems` (and `cancel-visual-redeem` if still referenced)
- **Account / compliance:** `delete-user-account`
- **Telemetry:** `ingest-analytics-event`
- **AI (as used by pilot builds):** `ai-generate-ad-variants`, `ai-extract-menu`, `ai-compose-offer`, `ai-generate-deal-copy`, `ai-business-lookup`, `ai-deal-suggestions`, `ai-translate-deal`, `ai-create-deal` (legacy)
- **Billing (if charging pilots):** `billing-pricing`, `stripe-create-checkout-session`, `stripe-customer-portal-session`, `stripe-webhook`, `billing-checkout-redirect`; treat `simulate-subscribe` as **QA-only**

### 4.3 Deploy commands (PRODUCTION-CHANGING — do not run until approved)

Per function:

```bash
npx supabase functions deploy <function-name>
```

Batch (verify your CLI supports this — check `npx supabase functions deploy --help`):

```bash
npx supabase functions deploy
```

---

## 5. Supabase secrets (names only)

Never paste real secret values into tickets or commits.

### 5.1 Required for most Edge behavior

| Secret | Notes |
|--------|--------|
| `SUPABASE_URL` | Often auto-provided on hosted Supabase; confirm present for Deno functions. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin client. |
| `OPENAI_API_KEY` | Required for real AI paths for non-demo users. |

### 5.2 Strongly recommended for product quality

| Secret | Notes |
|--------|--------|
| `GOOGLE_PLACES_API_KEY` | Used by `ai-business-lookup` for Places results. |

### 5.3 Optional model / tuning (names only)

| Secret | Notes |
|--------|--------|
| `OPENAI_MODEL` | Chat model allowlist in `_shared/openai-chat-model.ts`. |
| `OPENAI_WHISPER_MODEL` | Voice path in `ai-compose-offer`. |
| `OPENAI_IMAGE_MODEL_DEFAULT` | Default for both generate and edit when role-specific vars unset (`_shared/dalle-image.ts`); allowlisted ids only; invalid → `gpt-image-2`. |
| `OPENAI_IMAGE_MODEL_GENERATE` | Text-to-image / poster generation (`_shared/dalle-image.ts`); falls back to `OPENAI_IMAGE_MODEL_DEFAULT` then `gpt-image-2`. |
| `OPENAI_IMAGE_MODEL_EDIT` | Uploaded-photo edits (`_shared/dalle-image.ts`); falls back to `OPENAI_IMAGE_MODEL_DEFAULT` then `gpt-image-2`. |
| `AI_ADS_DEMO_USE_LIVE` | When `true`, demo account can use live OpenAI for ads paths. |
| `AI_COMPOSE_PROMPT_VERSION` | `ai-compose-offer` |
| `AI_DEDUP_WINDOW_SECONDS` | `ai-compose-offer` |
| `AI_COPY_MONTHLY_LIMIT` | `ai-generate-deal-copy` |
| `AI_INSIGHTS_MONTHLY_LIMIT` | `ai-deal-suggestions` |
| `AI_MONTHLY_LIMIT` | `_shared/ai-limits.ts` |
| `AI_COOLDOWN_SECONDS` | `_shared/ai-limits.ts` |

### 5.4 Menu extraction safety

| Secret | Notes |
|--------|--------|
| `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY` | **Do not set to `true` in production.** If `true`, missing `OPENAI_API_KEY` may yield synthetic sample menu data. Production should return a clear configuration error instead. |

### 5.5 Stripe / billing (if billing functions are deployed)

| Secret | Notes |
|--------|--------|
| `STRIPE_SECRET_KEY` | Checkout, portal, webhook processing. |
| `STRIPE_WEBHOOK_SECRET` | Preferred name in code; `STRIPE_WEBHOOK_SIGNING_SECRET` also accepted by `stripe-webhook`. |

### 5.6 QA-only gate

| Secret | Notes |
|--------|--------|
| `BILLING_SIMULATE_SUBSCRIBE` | Must be `true` for `simulate-subscribe` to run (dev/QA). |

### 5.7 List secret names via CLI

```bash
npx supabase secrets list
```

**Warning:** Confirm your CLI version’s behavior; if output might include values, use **Dashboard → Project Settings → Edge Functions → Secrets** instead (UI lists names without exposing values in list view).

Setting values is **PRODUCTION-CHANGING:**

```bash
npx supabase secrets set KEY=value
```

---

## 6. EAS production environment

### 6.1 Profiles (from `eas.json`)

- **`production`:** `environment: production`, `autoIncrement: true`. Does **not** inject demo/debug `EXPO_PUBLIC_*` flags (unlike `development` / `preview`).
- **`apk`:** extends `production` with `android.buildType: apk` for APK artifacts.

### 6.2 Required `EXPO_PUBLIC_*` for production Android

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | Hosted Supabase API URL. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Anon (public) key. |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Android Maps SDK (`app.config.js` → `android.config.googleMaps.apiKey`). |

### 6.3 Recommended explicit overrides

| Variable | Notes |
|----------|--------|
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | Defaults exist in app; explicit EAS values avoid drift. |
| `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` | Same. |
| `EXPO_PUBLIC_SUPPORT_URL` | Optional default in app. |
| `EXPO_PUBLIC_DELETE_ACCOUNT_URL` | Optional default in app. |
| `EXPO_PUBLIC_GIT_COMMIT` | Optional; short SHA for diagnostics (`app.config.js`). |

### 6.4 Must stay off for store / production builds

Do **not** set these to dev-like `true` on production:

- `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER`
- `EXPO_PUBLIC_SHOW_DEBUG_PANEL`
- `EXPO_PUBLIC_DEBUG_BOOT_LOG`
- `EXPO_PUBLIC_PREVIEW_MATCHES_DEV`

### 6.5 Read-only EAS inspection

Confirm flags with `npx eas <command> --help` for your installed CLI version.

```bash
npx eas whoami
npx eas project:info
npx eas env:list --environment production
```

---

## 7. Android production APK / AAB plan

### 7.1 Commands (PRODUCTION-CHANGING — do not run until approved)

**Google Play default (AAB):**

```bash
npx eas build --platform android --profile production
```

**APK (internal distribution / sideload):**

```bash
npx eas build --platform android --profile apk
```

### 7.2 Pre-build checks

- [ ] On `main` (or release branch) with a **clean** intent: no stray untracked junk; committed state matches what you ship.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green.
- [ ] Optional: `npm run typecheck:functions` (requires **Deno** on PATH).
- [ ] EAS `production` environment variables set (Section 6).
- [ ] Supabase hosted project ready (migrations, storage, functions, secrets) if the build will hit production backend.

---

## 8. Hosted smoke test sequence

Based on [pilot-smoke-test-checklist.md](./pilot-smoke-test-checklist.md). Run against **hosted** Supabase and a **production-like** app build.

### 8.1 Happy path (numbered)

1. Create a **consumer** account and verify sign-in success.
2. Complete consumer onboarding.
3. Allow location access (or enter ZIP if prompted).
4. Create a **business** account.
5. Enter invite code and confirm business access is granted.
6. Complete business setup profile.
7. Create at least one menu item (scan or manual entry).
8. Upload a deal photo.
9. Create a strong deal (meets 40%+ / BOGO / free-item rule).
10. Publish the deal.
11. Open consumer app/feed and verify published deal appears.
12. Claim the deal.
13. Open Wallet and verify active claim appears with expiry.
14. Start visual redeem.
15. Complete visual redeem.
16. Scan QR or enter short code on merchant side and confirm redeem success.
17. Open business dashboard and confirm claim/redeem metrics update.
18. Submit a report from app.
19. Confirm the report row appears in Supabase for the expected business/user.

### 8.2 Negative tests (pass / fail)

| # | Scenario | Pass criterion |
|---|----------|----------------|
| N1 | Weak deal under 40% discount | Rejected with clear messaging. |
| N2 | Expired deal | Cannot be newly claimed. |
| N3 | Max claims reached | Blocks additional claims. |
| N4 | Same user claim cooldown | Cannot claim twice within one-hour limit. |
| N5 | Same user, same business, same local day | Cannot claim same business twice in one local day (per product rules). |
| N6 | Incomplete business profile | Business user cannot create deal. |
| N7 | Location denied | Consumer can proceed with ZIP fallback. |
| N8 | Bad ZIP | Clear validation error. |
| N9 | Very large image upload | Fails gracefully; plain-language message. |
| N10 | Blurry menu photo | Low-legibility guidance; not silent success. |
| N11 | Missing `OPENAI_API_KEY` on `ai-extract-menu` | Clear configuration error in production mode (no fake menu as real OCR). |
| N12 | No internet during critical flow | Friendly retry guidance; no raw stack/infra error. |

### 8.3 Hosted AI / RLS spot checks

Also run scenarios in [production-deploy-checklist.md §7](./production-deploy-checklist.md): non-demo users must not see silent AI fallbacks that look like real data; RLS and storage paths must not allow cross-tenant writes.

### 8.4 Pilot readiness exit criteria

From [pilot-smoke-test-checklist.md](./pilot-smoke-test-checklist.md):

- Happy path completes without manual DB patching.
- Negative tests return clear user-facing messages.
- No raw Supabase/RLS/internal error strings in tested paths.
- Dashboard and analytics events sufficient for pilot support triage.

---

## 9. Verification summary (fill in when you run this plan)

### 9.1 Read-only commands recommended at repo start

| Command | Purpose |
|---------|---------|
| `git status` | Working tree clean? |
| `git branch --show-current` | On `main` (or intended release branch)? |
| `npm run typecheck` | TypeScript app |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run typecheck:functions` | Deno check on Edge sources (optional) |
| `npx supabase projects list` | Confirm account access |
| `npx supabase migration list` | After `link`; local vs remote migrations |
| `npx eas whoami` / `npx eas env:list --environment production` | EAS readiness |

### 9.2 Commands to run next (typical order)

1. Repo hygiene: clean working tree, tag candidate commit.
2. `npm run typecheck`, `npm run lint`, `npm test` (and optional `typecheck:functions`).
3. `npx supabase link` → `npx supabase migration list` → human review → **`db push` only if approved**.
4. Dashboard: Storage buckets/policies, Auth URLs, Stripe webhook (if used).
5. Set Edge secrets (names in Section 5) without pasting values into chat.
6. **`functions deploy` only if approved**.
7. `eas env:list` → **`eas build` only if approved**.
8. Execute Section 8 smoke tests on device.

### 9.3 Manual dashboard checks (cannot fully automate)

- **Database → Migrations:** last applied migration matches Section 2.
- **Storage:** bucket visibility and policies match Section 3.
- **Auth:** site URL and redirect allow list for your app scheme / domains.
- **Stripe:** webhook endpoint and signing secret alignment (if billing live).
- **Google Cloud:** Maps and Places key restrictions match your package name / SHA / IP policy.
- **Legal URLs:** open privacy/terms in a browser and confirm they match store listing expectations.

### 9.4 What should not be automated without human gates

- Entering or rotating secret **values** in CI logs or tickets.
- `db push` or destructive SQL on production without explicit sign-off and backup mindset.
- Store submission or phased rollout decisions.
- Skipping smoke tests because “CI passed.”

---

## 10. Verification flow (reference)

```mermaid
flowchart LR
  repoClean[Repo_clean_and_main]
  npmChecks[npm_typecheck_lint_test]
  supalink[supabase_link]
  miglist[migration_list_readonly]
  migpush[db_push_explicit_approve]
  secrets[Dashboard_or_secrets_CLI]
  fndeploy[functions_deploy_explicit_approve]
  easenv[eas_env_list]
  easbuild[eas_build_explicit_approve]
  smoke[pilot_smoke_hosted]

  repoClean --> npmChecks
  npmChecks --> supalink
  supalink --> miglist
  miglist --> migpush
  migpush --> secrets
  secrets --> fndeploy
  fndeploy --> easenv
  easenv --> easbuild
  easbuild --> smoke
```

# Deployment notes

## Deployment order

1. **Supabase database** — Apply **all** SQL migrations in `supabase/migrations/` in **filename (timestamp) order** on the target project (see list below). Do not skip older files on a fresh project.
2. **Edge Function secrets** — In Supabase Dashboard → Project Settings → Edge Functions → Secrets, set at least:
   - `SUPABASE_URL` (often injected by platform)
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY` (and optional model overrides) for AI-related functions; see `.env.example`.
3. **Edge Functions** — Deploy every function the app invokes (see list below). Redeploy after changing shared secrets or function code.
4. **Mobile app (EAS / local)** — Build with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and optional `EXPO_PUBLIC_*` legal URL overrides (see Environment variables).

## Database migrations

Apply migration files in **filename (timestamp) order**. The authoritative full inventory is in `docs/deployment-command-plan.md` section 2; as of this checkpoint the repo has 104 migration files and the latest is `20260730127000_stripe_business_billing_reconnection.sql`.

Read-only compare:

```bash
npx supabase migration list
```

Production-changing apply, only after explicit approval:

```bash
npx supabase db push
```

High-signal dependencies:

- **Merchant UI:** `20260327120000_launch_visual_redeem_analytics.sql`, `20260328140000_merchant_insights_rpc.sql`.
- **Billing / Stripe:** `20260601153000_billing_v4_app_config_and_subscription_rls.sql`, `20260601160000_create_subscription_history.sql`, the July 2026 trial, credits, suspension, and refund migrations, and `20260730127000_stripe_business_billing_reconnection.sql`.
- **Menu / locations:** `20260429120000_business_menu_items.sql`, `20260530120000_business_locations_deal_location.sql`, `20260708130000_nearby_geo_rpcs.sql`.
- **Realtime / claim safety:** `20260704120001_enable_deals_realtime.sql`, `20260704130000_enforce_max_claims_atomic.sql`, `20260721120000_deal_wallet_redemption_rules.sql`.
- **Role split:** `20260711120000_profiles_role.sql`.
- **Offer versions:** `20260723120000_offer_versions_foundation.sql`, `20260724120000_offer_version_publish_rpc.sql`, `20260724121000_offer_version_claim_redemption_binding.sql`.
- **AI / localization:** `20260722120000_ai_generation_cost_ledger.sql`, `20260727120000_ai_provider_circuit_breakers.sql`, `20260728120000_ad_localization_storage.sql`, `20260728123000_customer_deal_localization_projection.sql`.
- **Deal release push scheduling:** `20260729120000_deal_release_push_events.sql`, then `20260729121000_deal_release_push_cron_schedule.sql`. These create the service-role-only idempotency table, Vault-backed cron secret verifier, and five-minute dispatcher for due release pushes. Applying them is production-changing and requires explicit approval.
- **Ended-deal owner cleanup / poster projection:** `20260730120000_deals_owner_delete_ended.sql`, then `20260730121000_customer_deal_poster_spec_projection.sql`. These add owner cleanup for ended deals and a customer-safe native poster spec projection RPC. Applying them is production-changing and requires explicit approval.
- **Business application intake:** `20260730123000_business_applications.sql`, then `20260730124000_business_onboarding_workflow.sql`. These add the reviewed website access-request table, deterministic onboarding tier/risk metadata, field-invite placeholders, indexes, `updated_at` trigger, and RLS-closed client posture. Applying them is production-changing and requires explicit approval.
- **Admin dashboard foundation:** `20260730125000_admin_dashboard_foundation.sql`. This adds the web/admin allowlist, audit log, admin notes, launch areas, feature flags, system events, business status/access fields, and the central `can_business_publish` helper. Applying it is production-changing and requires explicit approval.
- **Website-to-app onboarding sync:** `20260730126000_website_app_onboarding_sync.sql`. This links website requests, app owner membership, field-source tracking, revision history, setup checklist, terms acceptance, slow-hour/promotable-item seeds, and the hardened publish helper. Applying it is production-changing and requires explicit approval.
- **Stripe business billing reconnection:** `20260730127000_stripe_business_billing_reconnection.sql`. This adds business billing profiles, subscriptions, billing events, checkout/portal audit tables, sync jobs, reminders, single-use billing tokens, and a publish helper that reads business subscription state before falling back to legacy location entitlements. Applying it is production-changing and requires explicit approval.

## Edge Functions to deploy (exact set)

Recommended: `npx supabase functions deploy` deploys every folder under `supabase/functions/` that ships in this repo. Below is the full inventory grouped by purpose.

**Wallet / redeem / claim:**

| Function | Purpose |
|----------|---------|
| `claim-deal` | Create claim, `expires_at`, telemetry |
| `redeem-token` | Staff QR / short-code redeem |
| `begin-visual-redeem` | Consumer "Use Deal" start |
| `complete-visual-redeem` | Consumer pass completion |
| `cancel-visual-redeem` | Deprecated path (returns 400); keep deployed if referenced |
| `finalize-stale-redeems` | Auto-finalize stuck `redeeming` claims (~30s TTL) |

**Auth / account / analytics:**

| Function | Purpose |
|----------|---------|
| `delete-user-account` | Auth user deletion for consumers and business owners |
| `ingest-analytics-event` | Append-only client analytics |
| `deal-link` | Deep-link redirect for deal sharing |
| `submit-business-application` | Public website business access-request intake |
| `admin-dashboard-summary` | Internal admin dashboard summary, active-admin checked |
| `get-business-onboarding-context` | App-safe imported business onboarding context |
| `update-business-profile-section` | App-safe canonical business profile edits |
| `send-deal-push` | Push notifications when a deal goes live |

**AI flows:**

| Function | Purpose |
|----------|---------|
| `ai-compose-offer` | Voice / text/photo -> ad-copy compose (uses Whisper for voice and the shared text provider router for compose) |
| `ai-generate-ad-variants` | Single-ad pipeline (research → copy → GPT image generate or photo edit) |
| `ai-generate-deal-copy` | Quick-Deal "Suggest title" |
| `ai-create-deal` | Permanently disabled legacy endpoint; returns HTTP 410 |
| `ai-extract-menu` | Menu photo → structured items (vision) |
| `ai-business-lookup` | Business-setup lookup (name → address/phone/category) |
| `ai-deal-suggestions` | Deal idea suggestions |
| `ai-translate-deal` | Localize deal copy across EN / ES / KO |
| `publish-offer-version` | Versioned publish with exact presentation/localization approval enforcement |

**Billing / Stripe (required for paid plans):**

| Function | Purpose |
|----------|---------|
| `billing-pricing` | Read current pricing from `app_config` (no JWT) |
| `stripe-create-checkout-session` | Start web/admin Stripe Checkout for a business subscription |
| `stripe-customer-portal-session` | Open web/admin Stripe Customer Portal for a business |
| `stripe-ensure-customer` | Admin-only Stripe Customer creation/update for a business |
| `stripe-backfill-customers` | Admin-only, gated Stripe Customer backfill helper |
| `stripe-webhook` | Receive Stripe events; verifies via `STRIPE_WEBHOOK_SECRET` and syncs business subscription state |
| `billing-checkout-redirect` | Post-checkout web redirect to business billing pages |
| `simulate-subscribe` | **Dev only** — manually advance pilot accounts to `active` for QA |

See `docs/stripe-setup.md` for end-to-end Stripe test-mode bring-up (products, prices, webhook URL, secrets).

## Environment variables

### Expo app (build-time / `EXPO_PUBLIC_*`)

| Variable | Required | Notes |
|----------|----------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | No | Default: `https://www.twoferapp.com/privacy` in `lib/legal-urls.ts` |
| `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` | No | Default: `https://www.twoferapp.com/terms` |
| `EXPO_PUBLIC_SUPPORT_URL` | No | Default: `https://www.twoferapp.com/support` |
| `EXPO_PUBLIC_DELETE_ACCOUNT_URL` | No | Default: `https://www.twoferapp.com/delete-account` |
| `EXPO_PUBLIC_GIT_COMMIT` | No | Optional short SHA shown in **Diagnostics** / `app.config.js` `extra.gitCommit` (else `git rev-parse` at config time if available) |
| `EXPO_PUBLIC_SHOW_DEBUG_PANEL` | No | Settings → **Diagnostics (build / env)** screen |
| `EXPO_PUBLIC_ENABLE_SHARE_DEAL` | No | Share Deal kill switch. Only exact value `true` shows Share Deal UI or allows `deal_shares` reads/inserts; unset or any other value keeps the feature off. |
| `EXPO_PUBLIC_DEBUG_BOOT_LOG` | No | One-shot `[twoforone:boot]` JSON in Metro / Logcat |

### Production URL defaults vs explicit env

The app **runs in production with the built-in defaults** above when `EXPO_PUBLIC_*` legal keys are unset (`lib/legal-urls.ts`). **Recommendation:** Still set `EXPO_PUBLIC_PRIVACY_POLICY_URL` and `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` explicitly in EAS secrets for the store build you submit, so listing URLs and binary behavior cannot drift if defaults change in a future commit.

### Edge Function secrets (Supabase Dashboard)

| Secret | Used by | Required |
|--------|---------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Functions that call admin APIs or bypass RLS (`delete-user-account`, `stripe-webhook`, claim/redeem, `submit-business-application`) | **Yes** |
| `OPENAI_API_KEY` | OpenAI-backed AI paths, including Whisper voice transcription and OpenAI image generation/editing | **Yes for OpenAI paths** |
| `STRIPE_SECRET_KEY` | `stripe-create-checkout-session`, `stripe-customer-portal-session`, `stripe-ensure-customer`, `stripe-backfill-customers`, `stripe-webhook` | **Yes for billing** |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` (validates Stripe-Signature header) | **Yes for billing** |
| `STRIPE_PRICE_ID_TWOFER_PRO_MONTHLY` / `STRIPE_TWOFER_BUSINESS_PRICE_ID` | Fallback monthly business subscription price for web/admin checkout when runtime config does not provide one | Required if runtime config lacks price ids |
| `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` | Optional Stripe portal configuration id | Optional |
| `ENABLE_STRIPE_BACKFILL` | Must be `true` before `stripe-backfill-customers` performs writes; dry runs do not require it | Optional / controlled |
| `PAST_DUE_GRACE_DAYS` | Business subscription failed-payment grace window; defaults to 3 | Optional |
| `SITE_URL` | Website base URL for Checkout success/cancel and portal return pages | Optional; defaults to `https://www.twoferapp.com` |
| `OPENAI_MODEL` | Shared OpenAI chat model override; defaults to `gpt-5.5` and fails closed when set outside the allowlist | Optional |
| `OPENAI_WHISPER_MODEL` | Whisper voice transcription override for `ai-compose-offer` | Optional |
| `GEMINI_API_KEY` | Gemini text fallback, independent judging, vision QA fallback, and Gemini image generation when the related flags are enabled | Required only for Gemini paths |
| `GEMINI_TEXT_MODEL`, `GEMINI_JUDGE_MODEL` | Gemini structured text and independent-judge model overrides; default `gemini-3.5-flash` | Optional |
| `AI_V3_PROVIDER_ROUTER_ENABLED`, `AI_TEXT_PRIMARY_PROVIDER`, `AI_TEXT_FALLBACK_ENABLED`, `AI_TEXT_FALLBACK_PROVIDER` | Shared text provider router and optional Gemini fallback | Optional; keep fallback disabled in production until the public privacy/subprocessor update is deployed |
| `AI_TEXT_PRIMARY_TIMEOUT_MS`, `AI_TEXT_FALLBACK_TIMEOUT_MS`, `AI_TRANSIENT_RETRY_MAX`, `AI_RETRY_AFTER_FULL_TIMEOUT` | Shared text provider timeout/retry tuning | Optional |
| `AI_CIRCUIT_BREAKER_ENABLED` | Enables provider circuit-breaker checks when the shared text router is enabled | Optional; requires the circuit-breaker migration to be applied first |
| `AI_V3_INDEPENDENT_JUDGE_ENABLED` | Enables Gemini independent candidate judging for ad variants | Optional |
| `AI_VISION_FALLBACK_ENABLED`, `AI_VISION_FALLBACK_PROVIDER`, `AI_VISION_PRIMARY_TIMEOUT_MS`, `AI_VISION_FALLBACK_TIMEOUT_MS`, `AI_STOCK_QA_CANDIDATE_LIMIT` | Ad image QA fallback and stock-candidate QA tuning | Optional |
| `AI_V3_COST_BUDGET_ENABLED`, `AI_TEXT_COST_SOFT_LIMIT_USD`, `AI_TEXT_COST_HARD_LIMIT_USD`, `AI_TOTAL_GENERATION_COST_HARD_LIMIT_USD`, `AI_REVISION_COST_HARD_LIMIT_USD` | AI provider cost projection/budget controls | Optional |
| `OPENAI_IMAGE_MODEL_DEFAULT`, `OPENAI_IMAGE_MODEL_GENERATE`, `OPENAI_IMAGE_MODEL_EDIT` | GPT image model ids for `dalle-image.ts` (allowlisted server-side; default `gpt-image-1`) | Optional |
| `AI_IMAGE_PROVIDER`, `AI_IMAGE_FALLBACK_PROVIDER`, `AI_IMAGE_GEMINI_ENABLED`, `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_ESTIMATED_COST_1K_USD`, `AI_IMAGE_OWNER_PHOTO_REFERENCE_ENABLED`, `AI_IMAGE_STOCK_FALLBACK_ENABLED` | Ad-image provider selection, Gemini image model/cost estimate, owner-photo reference, and stock fallback controls | Optional; Gemini image paths also require `GEMINI_API_KEY` |
| `AI_V5_PERSUASIVE_TRANSCRATION_ENABLED`, `AI_V5_TRANSLATION_QA_ENABLED`, `AI_V5_DETERMINISTIC_LANGUAGE_FALLBACK_ENABLED`, `AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED` | Multilingual transcreation, QA, fallback, and server-side exact approval gates | Optional; keep off until `docs/localization/multilingual-deals-production-approval-runbook.md` gates pass |
| `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY` | Allows synthetic menu scan output when `OPENAI_API_KEY` is missing (preview/dev only) | Optional (do not set in production) |

**⚠️ Without `OPENAI_API_KEY`,** `ai-extract-menu` now returns a clear configuration error (`OPENAI_NOT_CONFIGURED`) in production-style behavior. Set `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY=true` only in preview/dev projects if you intentionally want synthetic sample rows for demos.
Upstream menu extraction provider failures return `OPENAI_ERROR` with sanitized status telemetry rather than raw provider response bodies. Outer menu extraction failures log a fixed `SERVER_ERROR` code rather than free-form exception text.

`ai-generate-deal-copy`, `ai-deal-suggestions`, and `ai-translate-deal` also return plain-language errors with `error_code: OPENAI_NOT_CONFIGURED` when `OPENAI_API_KEY` is missing. These helpers can continue through the shared Gemini text router only when the router flags and `GEMINI_API_KEY` are configured. Provider-config and outer helper failures log fixed error codes rather than raw exception text.

`ai-compose-offer` returns a plain-language error with `error_code: OPENAI_KEY_MISSING` when required provider configuration is missing. Text/photo compose can continue through the shared Gemini text router only when the router flags and `GEMINI_API_KEY` are configured; the voice transcription-only path still requires OpenAI/Whisper.

Provider failure bodies are not returned to clients. `ai-compose-offer`, `ai-generate-deal-copy`, `ai-deal-suggestions`, and `ai-translate-deal` return only `error_code: AI_GENERATION_FAILED` for upstream text generation failures. `ai-create-deal` no longer calls a provider and always returns `AI_CREATE_DEAL_LEGACY_DISABLED`. Shared OpenAI/Gemini text-provider exceptions keep classification codes but use generic provider/code messages, and router/circuit-breaker/cost-ledger maintenance failures log fixed error codes. `ai-business-lookup` Google exception paths and `ai-generate-ad-variants` research, copy, image QA, image generation, and image edit failure paths log fixed stage/error codes instead of raw upstream response bodies or free-form exception text.

**Setting Edge secrets:**

```bash
# In Supabase Dashboard → Project Settings → Edge Functions → Secrets
# OR via CLI:
npx supabase secrets set OPENAI_API_KEY=sk-...
npx supabase secrets set OPENAI_IMAGE_MODEL_DEFAULT=gpt-image-1
npx supabase secrets set OPENAI_IMAGE_MODEL_GENERATE=gpt-image-1
npx supabase secrets set OPENAI_IMAGE_MODEL_EDIT=gpt-image-1
npx supabase secrets set AI_V3_PROVIDER_ROUTER_ENABLED=true
npx supabase secrets set AI_TEXT_FALLBACK_ENABLED=false
npx supabase secrets set AI_V3_COST_BUDGET_ENABLED=true
npx supabase secrets set AI_CIRCUIT_BREAKER_ENABLED=false
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

## One-time cleanup: legacy `expires_at` / grace

Current product behavior: **`expires_at` is the concrete instance end**; redemption is allowed until **`expires_at` + `grace_period_minutes`** (default 10) on the server and in the wallet UI.

If you have **old** `deal_claims` rows created under a prior interpretation where `expires_at` already included the grace window (or otherwise does not match the above), a **one-off SQL review** may be needed (e.g. adjust `expires_at` for affected rows after backup). **Fresh environments** with only current migrations and new claims can ignore this. There is no automatic migration in-repo that rewrites historical claim rows.

## Account deletion policy (deployed behavior)

- **Consumers and business owners**: Consumer Settings and the business Account tab both expose delete-account controls that call `delete-user-account` → `auth.admin.deleteUser`. The confirmation dialog warns business owners that their business, deals, and related claim history will also be removed.
- Deleting the auth user relies on the deployed schema's cascade behavior for owned rows. If the Edge function fails, the app shows a friendly error and links to the configured delete-account web URL.

## Public website URLs (app + store listings)

The mobile app opens these production pages via `lib/legal-urls.ts`. Override with Expo public env vars when needed.

| Constant / env key | Production default URL |
|--------------------|-------------------------|
| `PRIVACY_POLICY_URL` / `EXPO_PUBLIC_PRIVACY_POLICY_URL` | https://www.twoferapp.com/privacy |
| `TERMS_OF_SERVICE_URL` / `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` | https://www.twoferapp.com/terms |
| `SUPPORT_URL` / `EXPO_PUBLIC_SUPPORT_URL` | https://www.twoferapp.com/support |
| `DELETE_ACCOUNT_URL` / `EXPO_PUBLIC_DELETE_ACCOUNT_URL` | https://www.twoferapp.com/delete-account |

See `.env.example` for a commented template.

---

## Real-device QA checklist

Run on a **physical** device (iOS + Android if you ship both). Check off each item.

| Area | Check |
|------|--------|
| Auth | Sign up (new email) |
| Auth | Log in |
| Auth | Log out |
| Auth | Reset password (forgot → email link → new password) |
| Onboarding | Complete onboarding **without** gender (gender not required) |
| Profile | Birthday entry (`consumer-profile-setup`) |
| Location | ZIP fallback when GPS unavailable or denied |
| Location | Location permission granted path (GPS) |
| Deals | Claim deal |
| Wallet | Active deal appears and countdown / redeem-by looks correct |
| Redeem | **Use Deal** flow (slide → pass → complete) |
| Redeem | Force-kill app **during** redeem; reopen wallet — state sane, no duplicate redeem |
| Redeem | Background app **during** redeem; return foreground — behavior correct |
| Redeem | Stale `redeeming` auto-finalizes (~30s / `finalize-stale-redeems`) |
| Wallet | Expired claim (past redeem-by) shows as ended / correct copy |
| Deals | Ended / past campaign deals — browse + detail behavior |
| Account | Delete account completes for consumer and business-owner accounts after explicit confirmation |
| Merchant | Dashboard / deal analytics: **merchant insights** visible when RPC + migrations applied; aggregates only |

---

## What stays “undeployed” until you run ops

The following are **implemented in code** but **not** applied by committing alone:

- Running SQL migrations on the Supabase project
- Deploying Edge Functions and setting Edge secrets
- Publishing store builds with correct `EXPO_PUBLIC_*` values
- Hosting live pages at the legal/support URLs your build points to

Anything **not** listed in this repo (e.g. store listing assets, payment integrations) remains out of scope here.

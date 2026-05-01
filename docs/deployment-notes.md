# Deployment notes

## Deployment order

1. **Supabase database** — Apply **all** SQL migrations in `supabase/migrations/` in **filename (timestamp) order** on the target project (see list below). Do not skip older files on a fresh project.
2. **Edge Function secrets** — In Supabase Dashboard → Project Settings → Edge Functions → Secrets, set at least:
   - `SUPABASE_URL` (often injected by platform)
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY` (and optional model overrides) for AI-related functions; see `.env.example`.
3. **Edge Functions** — Deploy every function the app invokes (see list below). Redeploy after changing shared secrets or function code.
4. **Mobile app (EAS / local)** — Build with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and optional `EXPO_PUBLIC_*` legal URL overrides (see Environment variables).

## Database migrations (exact set)

Apply migration files in **filename (timestamp) order**. Easiest: `npx supabase db push` against the linked project after `npx supabase link --project-ref <ref>` — it applies any unmigrated files. The full ordered list as of launch:

| Order | File |
|------:|------|
| 1 | `20250127000000_initial_schema.sql` |
| 2 | `20260127000001_add_deal_templates_and_recurring.sql` |
| 3 | `20260128120000_business_profile_ai_context.sql` |
| 4 | `20260129100000_deal_quality_tier.sql` |
| 5 | `20260130120000_business_preferred_locale.sql` |
| 6 | `20260323120000_users_read_claimed_deals.sql` |
| 7 | `20260324120000_business_coordinates.sql` |
| 8 | `20260324180000_business_consumer_profile_fields.sql` |
| 9 | `20260325120000_ai_generation_logs.sql` |
| 10 | `20260325120100_ai_compose_quota_rpc.sql` |
| 11 | `20260325183000_strong_deal_only_guardrail.sql` |
| 12 | `20260326120000_consumer_profiles_business_contact.sql` |
| 13 | `20260326210000_deal_claims_short_code.sql` |
| 14 | `20260327120000_launch_visual_redeem_analytics.sql` |
| 15 | `20260328140000_merchant_insights_rpc.sql` |
| 16 | `20260330120000_fix_deal_claims_deals_rls_recursion.sql` |
| 17 | `20260330140000_deals_public_read_start_time_deal_templates_timezone.sql` |
| 18 | `20260331120000_deal_poster_storage_public_read.sql` |
| 19 | `20260401120000_add_claim_blocked_reason_mix_to_merchant_business_insights.sql` |
| 20 | `20260401150000_update_strong_deal_guardrail_free_item.sql` |
| 21 | `20260402120000_push_tokens.sql` |
| 22 | `20260402130000_server_set_quality_tier.sql` |
| 23 | `20260403120000_consumer_push_prefs.sql` |
| 24 | `20260404120000_app_analytics_events_select_business_owner.sql` |
| 25 | `20260429120000_business_menu_items.sql` |
| 26 | `20260502120000_profiles_app_tab_mode.sql` |
| 27 | `20260530120000_business_locations_deal_location.sql` |
| 28 | `20260601000000_create_business_profiles.sql` |
| 29 | `20260601153000_billing_v4_app_config_and_subscription_rls.sql` |
| 30 | `20260601160000_create_subscription_history.sql` |
| 31 | `20260630120000_lockdown_deal_claims_client_insert.sql` |
| 32 | `20260630123000_enforce_business_locations_cap_insert_rls.sql` |
| 33 | `20260701120001_enable_rate_limits_rls.sql` |
| 34 | `20260701120002_enable_app_config_rls_backend_only.sql` |
| 35 | `20260701130000_fix_deal_claims_rls_recursion_billing_v4.sql` |
| 36 | `20260702120000_deal_translation_columns.sql` |
| 37 | `20260703120000_add_analytics_business_id_index.sql` |
| 38 | `20260703120001_push_token_cleanup.sql` |
| 39 | `20260703120002_birthdate_check_constraint.sql` |
| 40 | `20260703120003_deal_claims_status_changed_at.sql` |
| 41 | `20260703120004_timezone_validation.sql` |
| 42 | `20260704120000_enable_deals_realtime.sql` |

**Launch-critical for merchant UI:** `20260327120000_launch_visual_redeem_analytics.sql` (claim lifecycle + analytics) and `20260328140000_merchant_insights_rpc.sql` (`merchant_business_insights`, `merchant_deal_insights` RPCs).

**Launch-critical for billing (Stripe):** `20260601153000_billing_v4_app_config_and_subscription_rls.sql` (creates `app_config`, `business_profiles.subscription_*` columns, RLS) and `20260601160000_create_subscription_history.sql`. After applying, **seed the `app_config` row with current pricing** — the `billing-pricing` Edge function reads it. See `docs/stripe-setup.md`.

**Launch-critical for menu / locations:** `20260429120000_business_menu_items.sql` (AI menu OCR storage), `20260530120000_business_locations_deal_location.sql` (multi-location).

**Launch-critical for realtime:** `20260704120000_enable_deals_realtime.sql` (Supabase Realtime publication on `deals`).

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
| `delete-user-account` | Auth user deletion (blocks business owners — see policy below) |
| `ingest-analytics-event` | Append-only client analytics |
| `deal-link` | Deep-link redirect for deal sharing |
| `send-deal-push` | Push notifications when a deal goes live |

**AI flows:**

| Function | Purpose |
|----------|---------|
| `ai-compose-offer` | Voice / text → ad-copy compose (uses Whisper for voice) |
| `ai-generate-ad-variants` | 3 distinct ad variants (value / neighborhood / premium) + DALL-E |
| `ai-generate-deal-copy` | Quick-Deal "Suggest title" |
| `ai-create-deal` | Legacy one-shot deal insert (dev tool) |
| `ai-extract-menu` | Menu photo → structured items (vision) |
| `ai-refine-ad-copy` | Chat-style refinement of selected ad |
| `ai-business-lookup` | Business-setup lookup (name → address/phone/category) |
| `ai-deal-suggestions` | Deal idea suggestions |
| `ai-translate-deal` | Localize deal copy across EN / ES / KO |

**Billing / Stripe (required for paid plans):**

| Function | Purpose |
|----------|---------|
| `billing-pricing` | Read current pricing from `app_config` (no JWT) |
| `stripe-create-checkout-session` | Start Stripe Checkout for Pro/Premium |
| `stripe-customer-portal-session` | Open Stripe Customer Portal for plan management |
| `stripe-webhook` | Receive Stripe events; verifies via `STRIPE_WEBHOOK_SECRET` |
| `billing-checkout-redirect` | Post-checkout deep-link return into the app |
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
| `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER` | No | With a preview/dev client profile, when `true`, shows **Demo login** (password sign-in only; no auto–sign-up). **Preview** in `eas.json` sets this; **production** does not. Local Metro (`expo start`) also enables Demo login via `__DEV__` even if unset. |
| `EXPO_PUBLIC_SHOW_DEBUG_PANEL` | No | Settings → **Diagnostics (build / env)** screen |
| `EXPO_PUBLIC_DEBUG_BOOT_LOG` | No | One-shot `[twoforone:boot]` JSON in Metro / Logcat |

### Production URL defaults vs explicit env

The app **runs in production with the built-in defaults** above when `EXPO_PUBLIC_*` legal keys are unset (`lib/legal-urls.ts`). **Recommendation:** Still set `EXPO_PUBLIC_PRIVACY_POLICY_URL` and `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` explicitly in EAS secrets for the store build you submit, so listing URLs and binary behavior cannot drift if defaults change in a future commit.

### Edge Function secrets (Supabase Dashboard)

| Secret | Used by | Required |
|--------|---------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Functions that call admin APIs or bypass RLS (`delete-user-account`, `stripe-webhook`, claim/redeem) | **Yes** |
| `OPENAI_API_KEY` | All `ai-*` Edge functions | **Yes** |
| `STRIPE_SECRET_KEY` | `stripe-create-checkout-session`, `stripe-customer-portal-session`, `stripe-webhook` | **Yes for billing** |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` (validates Stripe-Signature header) | **Yes for billing** |
| `OPENAI_MODEL`, `OPENAI_WHISPER_MODEL` | Override default models | Optional |
| `AI_ADS_DEMO_USE_LIVE` | Use live OpenAI (not stubbed) for `demo@demo.com` account | Optional |

**⚠️ Without `OPENAI_API_KEY`,** `ai-extract-menu` returns category-aware **fake menu items** as a fallback (no error to UI). Make sure the secret is set in production or pilot owners get fictional menus on first scan.

**Setting Edge secrets:**

```bash
# In Supabase Dashboard → Project Settings → Edge Functions → Secrets
# OR via CLI:
npx supabase secrets set OPENAI_API_KEY=sk-...
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

## One-time cleanup: legacy `expires_at` / grace

Current product behavior: **`expires_at` is the concrete instance end**; redemption is allowed until **`expires_at` + `grace_period_minutes`** (default 10) on the server and in the wallet UI.

If you have **old** `deal_claims` rows created under a prior interpretation where `expires_at` already included the grace window (or otherwise does not match the above), a **one-off SQL review** may be needed (e.g. adjust `expires_at` for affected rows after backup). **Fresh environments** with only current migrations and new claims can ignore this. There is no automatic migration in-repo that rewrites historical claim rows.

## Account deletion policy (deployed behavior)

- **Consumer-only** (no `businesses` row with `owner_id = auth user`): in-app delete calls `delete-user-account` → `auth.admin.deleteUser`. DB may still CASCADE related rows per your schema; this pass does **not** add new business CASCADE behavior.
- **Business owner** (≥1 business row for that user): Edge returns **403** with `code: BUSINESS_OWNER_DELETE_BLOCKED`; app shows localized **contact support** messaging and does not delete. Client also hides the destructive delete CTA when a business profile is loaded or ownership lookup fails (**fail-safe**).

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
| Account | Delete account (**consumer-only** account completes; **business owner** sees support message, no delete) |
| Merchant | Dashboard / deal analytics: **merchant insights** visible when RPC + migrations applied; aggregates only |

---

## What stays “undeployed” until you run ops

The following are **implemented in code** but **not** applied by committing alone:

- Running SQL migrations on the Supabase project
- Deploying Edge Functions and setting Edge secrets
- Publishing store builds with correct `EXPO_PUBLIC_*` values
- Hosting live pages at the legal/support URLs your build points to

Anything **not** listed in this repo (e.g. store listing assets, payment integrations) remains out of scope here.

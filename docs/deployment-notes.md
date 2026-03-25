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

Apply these migration files in order:

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
| 11 | `20260326120000_consumer_profiles_business_contact.sql` |
| 12 | `20260326210000_deal_claims_short_code.sql` |
| 13 | `20260327120000_launch_visual_redeem_analytics.sql` |
| 14 | `20260328140000_merchant_insights_rpc.sql` |

**Launch-critical for merchant UI:** `20260327120000_launch_visual_redeem_analytics.sql` (claim lifecycle + analytics) and `20260328140000_merchant_insights_rpc.sql` (`merchant_business_insights`, `merchant_deal_insights` RPCs).

## Edge Functions to deploy (exact set)

Deploy all folders under `supabase/functions/` that ship with this repo. The **wallet / redeem / account** flows require at minimum:

| Function | Purpose |
|----------|---------|
| `claim-deal` | Create claim, `expires_at`, telemetry |
| `redeem-token` | Staff QR / short-code redeem |
| `begin-visual-redeem` | Consumer “Use Deal” start |
| `complete-visual-redeem` | Consumer pass completion |
| `cancel-visual-redeem` | Deprecated path (returns 400); keep deployed if referenced |
| `finalize-stale-redeems` | Auto-finalize stuck `redeeming` claims (~30s TTL) |
| `delete-user-account` | Auth user deletion (blocks business owners — see policy below) |
| `ingest-analytics-event` | Append-only client analytics |

**AI / create flows (deploy if those product paths are live):**

| Function |
|----------|
| `ai-compose-offer` |
| `ai-generate-ad-variants` |
| `ai-generate-deal-copy` |
| `ai-create-deal` |

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
| `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER` | No | When `true`, `demo@demo.com` auto sign-up matches Metro dev behavior. **Preview** profile in `eas.json` sets this; **production** does not. |
| `EXPO_PUBLIC_SHOW_DEBUG_PANEL` | No | Settings → **Diagnostics (build / env)** screen |
| `EXPO_PUBLIC_DEBUG_BOOT_LOG` | No | One-shot `[twoforone:boot]` JSON in Metro / Logcat |

### Production URL defaults vs explicit env

The app **runs in production with the built-in defaults** above when `EXPO_PUBLIC_*` legal keys are unset (`lib/legal-urls.ts`). **Recommendation:** Still set `EXPO_PUBLIC_PRIVACY_POLICY_URL` and `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` explicitly in EAS secrets for the store build you submit, so listing URLs and binary behavior cannot drift if defaults change in a future commit.

### Edge Function secrets (Supabase Dashboard)

| Secret | Used by |
|--------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Functions that call admin APIs or bypass RLS (e.g. `delete-user-account`, claim/redeem edges as implemented) |
| `OPENAI_API_KEY` | AI Edge functions |
| Optional: `OPENAI_MODEL`, `OPENAI_WHISPER_MODEL`, `AI_ADS_DEMO_USE_LIVE` | See `.env.example` |

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

# Production deploy checklist (TWOFER)

Use this after merging to `main` and before pointing pilot traffic at a **hosted** Supabase project and a **production** EAS build. Do not paste real secrets into tickets or this file.

For day-to-day pilot QA, use `docs/pilot-smoke-test-checklist.md`. For Edge coverage detail, see `docs/edge-function-checklist.md`.

---

## 1. Supabase migrations (verify on remote)

**Rule:** Remote DB should match an ordered apply of everything under `supabase/migrations/` for your release. Confirm in Dashboard → **Database → Migrations** (or your migration runner) that nothing failed mid-chain.

**High-signal migrations for the recent pilot + main merge (confirm these exist and are applied):**

| Migration file | Why it matters |
|----------------|----------------|
| `20260703120005_claim_race_guards.sql` | Unique partial index: one active unredeemed claim per user (race-safe claims). |
| `20260704120000_business_logo_storage.sql` | `businesses.logo_url` + `business-logos` bucket + RLS for owner upload / public read. |
| `20260706130000_deal_photo_owner_upload_policies.sql` | `deal-photos` owner-scoped upload/update policies for AI + publishing. |
| `20260707120000_business_menu_item_sizes.sql` | Menu item `size_options` for scan → offer flows. |

**Also verify:**

- No duplicate timestamp prefixes on disk for *different* features (if two files share a prefix in Git history, confirm only the intended one ran on prod).
- `supabase db push` / CI against staging before prod, if available.

---

## 2. Supabase storage buckets (verify)

In Dashboard → **Storage**, confirm buckets and policies align with migrations:

| Bucket | Expected | Notes |
|--------|----------|--------|
| `deal-photos` | Public read (or as per migration); owner writes under `{business_id}/…` | AI ad images, deal posters. |
| `business-logos` | Public read; authenticated owners can insert/update | Logo picker in business setup. |

Smoke-test: owner uploads logo; owner uploads deal photo; consumer or logged-out read of public URLs works as designed.

---

## 3. Edge Functions to deploy

Deploy functions that exist in `supabase/functions/` and are referenced in `supabase/config.toml` (and by the app). Typical pattern:

```bash
supabase functions deploy <function-name>
```

**Core product / pilot-critical (non-exhaustive):**

- `claim-deal`, `redeem-token`
- `begin-visual-redeem`, `complete-visual-redeem`, `cancel-visual-redeem`
- `finalize-stale-redeems`
- `delete-user-account`
- `ingest-analytics-event`
- `ai-generate-ad-variants`, `ai-extract-menu`, `ai-compose-offer`, `ai-generate-deal-copy`, `ai-business-lookup`, `ai-deal-suggestions`, `ai-translate-deal`
- `ai-create-deal` (legacy; still keep behavior sane if enabled)
- Billing / Stripe: `billing-pricing`, `stripe-create-checkout-session`, `stripe-customer-portal-session`, `stripe-webhook`, and any redirect/simulate helpers your environment still uses

After deploy, hit each critical path once from a **non-demo** account (claim, redeem, AI create) and once from **demo** if you use preview builds.

---

## 4. Required Supabase secrets (names only)

Set in **Project Settings → Edge Functions → Secrets** (names may vary slightly by hosting UI):

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | Real GPT / vision for non-demo AI paths. |
| `SUPABASE_URL` | Usually injected by platform; confirm present for Deno functions. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase client in Edge Functions. |
| `GOOGLE_PLACES_API_KEY` | Optional but recommended for real `ai-business-lookup` results. |

**Optional / model tuning:**

- `OPENAI_MODEL` / `OPENAI_AD_MODEL` / team-specific chat model vars (see `supabase/functions/_shared/openai-chat-model.ts` and docs)
- `OPENAI_WHISPER_MODEL` (voice in `ai-compose-offer`, if used)
- `AI_ADS_DEMO_USE_LIVE` — when `true`, demo account uses live OpenAI instead of template/demo responses

**Menu extraction (preview / explicit opt-in only):**

- `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY` — must be **`true` only** on deliberately permissive preview/dev projects; **leave unset/false in production** so missing `OPENAI_API_KEY` returns a configuration error instead of synthetic menu rows.

---

## 5. Required EAS / app environment variables

Configured in `eas.json` profiles and/or Expo project env. **Production** should **not** enable demo-auth helpers or debug panels.

| Variable | Production expectation |
|----------|-------------------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Hosted Supabase project URL. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Anon key for that project. |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Valid key with Maps SDK for Android (map tab). |
| `EXPO_PUBLIC_DEMO_EMAIL` / `EXPO_PUBLIC_DEMO_PASSWORD` | Optional; only if you ship a known demo account (pilot decision). |
| `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER` | Should be **absent or false** on production store builds. |
| `EXPO_PUBLIC_SHOW_DEBUG_PANEL` / `EXPO_PUBLIC_DEBUG_BOOT_LOG` / `EXPO_PUBLIC_PREVIEW_MATCHES_DEV` | **Off** for production. |

Legal / support URLs: see `app.config.js` / `.env.example` (`EXPO_PUBLIC_PRIVACY_POLICY_URL`, etc.).

---

## 6. Android real-device QA (quick)

On a **physical Android** device with a **production** or **internal release** build:

- [ ] Cold start → auth → consumer feed loads without crash.
- [ ] Business mode → business setup → logo upload → fields save.
- [ ] Create flow: `/create/ai` or hub path → generate ad → publish path reaches strong-deal guard as expected.
- [ ] Stale deep link to `/create/ad-refine` shows placeholder and navigates to `/create/ai` without error.
- [ ] Menu scan: with valid backend, items appear; with missing AI config, **plain-language** error (no fake menu presented as real OCR).
- [ ] Claim → wallet → redeem happy path; second concurrent claim blocked appropriately.
- [ ] Map tab: Google Maps renders (key not restricted incorrectly).

---

## 7. Hosted smoke-test checklist

Run against **hosted** Supabase + production-like env (can reuse scenarios from `docs/pilot-smoke-test-checklist.md`):

- [ ] Non-demo user: AI business lookup does **not** return hardcoded Irving/demo rows on failure (expect error or empty real Places — not client fake addresses).
- [ ] Non-demo user: AI deal copy failure does **not** silently substitute template copy; missing OpenAI returns **503 / clear message** from Edge.
- [ ] Non-demo user: menu extract with no `OPENAI_API_KEY` returns **503** and `OPENAI_NOT_CONFIGURED` (or equivalent), **not** synthetic `items` unless explicit opt-in secret is set.
- [ ] Demo account (if enabled): template/demo paths still work for pilot demos.
- [ ] RLS: consumer cannot write another owner’s storage paths; owner cannot read others’ private rows.

---

## 8. Known risks (manual verification still required)

- **Stripe / billing:** `PILOT_DISABLE_BILLING_GATE` in app may extend trials for pilot; confirm billing Edge functions and webhooks match your go-live plan before turning enforcement on.
- **Google Places:** Without `GOOGLE_PLACES_API_KEY`, lookup may fall back to OpenAI-only or error — confirm messaging matches product expectations.
- **AI quotas / cost:** `ai_generation_logs` and any monthly caps — verify limits in Dashboard and owner-facing copy.
- **Push / deep links:** `send-deal-push`, email confirmation redirects — test on real devices.
- **Migration order:** A single failed migration on prod leaves schema half-applied; always verify last applied migration name and error logs.
- **Metro / CI:** Local “Unable to deserialize cloned data” Metro cache warnings are environmental; use `npx expo start -c` if bundler misbehaves (not a server deploy issue).

---

## 9. Related docs

- `docs/pilot-smoke-test-checklist.md` — operator-facing pilot QA
- `docs/edge-function-checklist.md` — function inventory and risk notes
- `docs/deployment-notes.md` — environment and function overview
- `docs/MIGRATIONS_AND_DEPLOY.md` — migration / deploy procedures (older focused notes)
- `docs/ui-polish-punch-list.md`, `docs/create-flow-simplification.md` — product/UX backlog (not blockers for infra deploy)

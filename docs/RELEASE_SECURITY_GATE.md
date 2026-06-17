# Twofer release security gate

A repeatable pre-release check covering six areas: secrets, RLS, rate limiting,
error handling, DB performance, and authorization.

## When to run it

Run the full gate **before any TestFlight or Play build**, and any time a change
touches **auth, Supabase tables/policies, Edge Functions, AI generation,
share links, push, or redemption**. If the gate fails, fix it before building.

## One-command local run

```bash
npm run typecheck        # tsc --noEmit
npm run lint
npm run test
npm run gate:edges       # edge functions deployed + authenticating
npm run gate:rls-smoke   # an authenticated user CAN read its own rows
npm run gate:rls         # no sensitive table leaks to anon (read-only)
gitleaks detect --source . --redact --no-banner --config .gitleaks.toml   # if gitleaks installed
```

The probes read `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
from `.env` (and `gate:rls-smoke` also needs `TWOFER_SMOKE_EMAIL` /
`TWOFER_SMOKE_PASSWORD` — a throwaway shopper account, never a real customer).

The deep catalog check needs an owner/service DB connection string:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/rls-inventory.sql
```

## What's automated

| Check | How | Where |
| --- | --- | --- |
| Secret scan (tree + full history) | `gitleaks` + [`.gitleaks.toml`](../.gitleaks.toml) | CI `secret-scan` job, every push/PR |
| Typecheck / lint / test | npm scripts | CI `check` job, every push/PR |
| Edge-function health | [`probe-edge-functions-smoke.mjs`](../scripts/probe-edge-functions-smoke.mjs) | `release-gate.yml` (PR→main / manual) |
| Authenticated RLS read-back | [`probe-rls-smoke.mjs`](../scripts/probe-rls-smoke.mjs) | `release-gate.yml` |
| Anon data-exposure | [`probe-rls-inventory.mjs`](../scripts/probe-rls-inventory.mjs) | `release-gate.yml` |
| Catalog RLS gate (table without RLS) | [`rls-inventory.sql`](../scripts/rls-inventory.sql) | `release-gate.yml` (if `SUPABASE_DB_URL` set) |

### CI secrets to set (Settings → Secrets and variables → Actions)

`release-gate.yml` skips its live steps (with a warning) until these exist:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — public values; enable edge + anon probes.
- `TWOFER_SMOKE_EMAIL`, `TWOFER_SMOKE_PASSWORD` — throwaway shopper; enables RLS smoke.
- `SUPABASE_DB_URL` — owner/service connection string; enables the catalog gate.
  **Never** put the service-role key or DB string anywhere in app code or `EXPO_PUBLIC_*`.

## Dan-only actions (dashboard / hard gates — not done by agents)

- **GitHub** → Settings → Code security: turn on **Secret scanning** and **Push
  protection** (defense in depth on top of the gitleaks job).
- **OpenAI** dashboard: set a monthly **budget limit** and **usage alerts** so a
  bug or abuse can't run up a surprise bill.
- **Supabase** dashboard: run **Security Advisor** and **Performance Advisor**
  before each release; clear anything flagged.
- Approve any **migration**, **push/merge**, or **build** (repo hard gates).

## The six areas

1. **Secrets** — nothing sensitive in the repo, history, or the app bundle.
   `EXPO_PUBLIC_*` is public (inlined into the APK); only the Supabase URL +
   anon key belong there. Service-role, OpenAI, Stripe, webhook, and Firebase
   service-account credentials live in Supabase Edge / EAS / GitHub secrets only.
2. **RLS** — every Data API-exposed table has RLS; users reach only their own
   rows; anon reaches no sensitive table. Run all three RLS checks after any
   policy migration.
3. **Rate limiting** — AI generation (30/mo + 60s cooldown), claims, redemption,
   and translation/share-lookup are capped. Push send is owner-gated server-side.
4. **Error handling** — every Supabase/RPC/Edge/OpenAI/Stripe/upload/share call
   checks `error`; no raw internals shown to users; publish/redeem/payment/AI
   fail closed.
5. **DB performance** — indexes on ownership/filter columns (`business_id`,
   `location_id`, `user_id`, `deal_id`, `status`, `expires_at`, `share_code`);
   lists paginated; no queries inside loops.
6. **Authorization** — every write verifies authentication **and** ownership/role
   in the DB or Edge Function, not just in the UI.

## Baseline (2026-06-17 diagnostic)

- **Secrets:** clean — no real secret in tree or history; `.env` untracked;
  `google-services.json` is Android client config (no service-account key).
- **RLS:** mature (76 migrations, smoke probe in place); needs a live run of the
  three checks above to confirm against prod.
- **Rate limiting:** AI ad/copy gen capped; **gaps:** `deal-link` (public share
  lookup) and `ai-translate-deal` have no limit yet.
- **DB performance:** strong (55 indexes; `deal_shares.share_code` covered by a
  UNIQUE constraint).
- **Authorization:** `verify_jwt=false` on ~30 functions, each doing its own
  auth in the samples checked; confirm the pattern for all of them.

Stripe hardening is deferred while billing is disabled (`PAID_BILLING_ENABLED=false`).

# Twofer money & trust audit — implementation roadmap

> Implementer: follow [SONNET_IMPLEMENTATION_PLAN.md](SONNET_IMPLEMENTATION_PLAN.md)
> for the ordered, phase-by-phase steps (Dan's decisions are baked in there).
> This file is the risk map and the invariants; the finding files hold the fixes.

## Stack & context (for an implementer with no prior knowledge)

Twofer is an Expo/React Native app with a Supabase backend (Postgres + Row
Level Security + Edge Functions in Deno/TypeScript). Consumers "claim" a deal,
which creates a `deal_claims` row with a QR token + short code; staff redeem it
either through a restricted "Redemption Mode" staff device (`staff-redemption`
edge function → `confirm_staff_redemption` RPC) or the business owner's own app
(`redeem-token` edge function), and a customer-side "visual redeem" honor-system
flow (`begin-visual-redeem` / `complete-visual-redeem`). Businesses pay through a
card-required Stripe subscription; the `stripe-webhook` edge function is the only
writer of the billing state that the app reads to gate publishing/claiming.

Two things you must internalize before touching anything:

1. **How the edge functions talk to the database.** Every function builds two
   Supabase clients. `supabase = createClient(url, SERVICE_KEY, { global: {
   headers: { Authorization: <end-user JWT> } } })` runs **as the end user with
   RLS enforced** (the service key is only the gateway `apikey`; PostgREST picks
   the role from the user's `Authorization` JWT = `authenticated`).
   `supabaseAdmin = createClient(url, SERVICE_KEY)` runs **as `service_role`
   with RLS bypassed.** This distinction is the whole ballgame: a bug is
   "which client did this write use." Proof this is how it works: `claim-deal`
   must use `supabaseAdmin` to INSERT a claim precisely because the client-side
   INSERT policy was dropped — if the user client bypassed RLS, that would be
   unnecessary.

2. **Supabase default grants.** New tables in `public` are granted
   `SELECT/INSERT/UPDATE/DELETE` to `anon` and `authenticated` by default; RLS
   then filters rows. `REVOKE ... FROM PUBLIC` does **not** remove those
   explicit role grants (this repo learned that the hard way — see the notes in
   `20260705120000_businesses_pii_column_grants.sql`). So any table with a
   permissive owner/user RLS UPDATE policy and no column-level revoke lets the
   client PATCH **any column of its own row** through PostgREST directly,
   regardless of what the app UI does. Findings 01 and 02 are two instances of
   exactly this.

## System invariants (the implementer's self-check)

A fix is wrong if it breaks any of these. After each fix, re-read this list.

- **INV-1 — Redemption is server-decided and single-use.** `deal_claims.redeemed_at`
  is write-once. A claim moves to `claim_status='redeemed'` at most once, only
  through a validated server path (the `confirm_staff_redemption` RPC, the
  `redeem-token` owner path, or `complete-visual-redeem` after its timer). A
  client must never be able to write `redeemed_at` / `claim_status` directly.
- **INV-2 — No un-redeeming.** A redeemed claim is terminal; it can never be
  reset to `active`/`redeeming` to be redeemed again. One claim = at most one
  free reward.
- **INV-3 — Access is server-owned.** Publish/claim access is granted **iff** the
  service-role-written mirror says so: `location_entitlements.status` in the
  active set, or `businesses.access_level` in the comped set, or
  `business_subscriptions.app_access_status` active/trialing. A client can never
  write `businesses.access_level`, `businesses.status`, `can_publish_cached`, or
  any `location_entitlements` / `business_subscriptions` column.
- **INV-4 — Billing state derives only from verified Stripe events or admin RPCs.**
  Every webhook event is signature-verified, livemode/environment-checked, and
  idempotent per Stripe event id. Access is never taken from a client-settable
  flag.
- **INV-5 — Trials are card-gated and one-per-identity.** A trial requires a
  Stripe checkout with `payment_method_collection: "always"`; each business /
  physical location may start at most one trial (cancel-and-restart must not
  yield a second free trial).
- **INV-6 — Secrets stay server-side.** PIN and exit-token hashes are never
  returned to clients. PINs are PBKDF2-hashed (already true). Staff redemption
  is rate-limited and locked out per counter device (already true).
- **INV-7 — One active claim per user, server-created.** The partial unique index
  `deal_claims_one_active_wallet_claim_per_user` holds; claim creation is
  service-role only.

## Findings, most dangerous first

Work top-down. Severity × exploitability drives the order; I will stop when I run
low on credits, so the top of this list is where the real money/trust risk is.

| ID | Severity | Surface | One-line description | Status |
|----|----------|---------|----------------------|--------|
| [01](findings/01-businesses-self-grant-access.md) | Critical | RLS | A business owner can PATCH `businesses.access_level='admin_comped'` (or `status`/`can_publish_cached`) on their own row and get free, permanent publish access, bypassing all billing. | CODE DONE — migration written, needs Dan to apply |
| [02](findings/02-deal-claims-self-redeem.md) | Critical | RLS / PIN | A customer can PATCH their own `deal_claims` row to self-redeem (no staff, no timer, no location check) and to reset a redeemed claim back to active and redeem it again. | CODE DONE — edge functions + migration written, needs Dan to deploy functions then apply migration |
| [03](findings/03-chargeback-not-handled.md) | High | Stripe | `charge.dispute.created` is not handled, so a business that charges back keeps full access indefinitely. | CODE DONE — needs Dan to deploy `stripe-webhook` + subscribe the endpoint to `charge.dispute.created` in Stripe Dashboard |
| [04](findings/04-column-write-hygiene-umbrella.md) | High | RLS | Systemic: `authenticated` retains default table-level UPDATE/INSERT on every owner-owned table (`businesses`, `deals`, `business_locations`, `business_profiles`, `favorites`); audit and lock each the way 01/02 do. | PARTIAL — `business_locations`/`business_profiles`/`favorites` audited and clean (see [recon](findings/04-column-write-hygiene-umbrella-recon.md)); `deals` needs Dan's product decision before any fix (hits the AI create/publish lock) |
| [05](findings/05-trial-reuse-guard.md) | Medium | Stripe | The self-serve Stripe checkout has no trial-reuse guard, so cancel-and-restart can yield repeated free trials (the admin trial path is guarded; this one isn't). | DONE, expanded scope (Dan, 2026-07-06) — built a no-card-trial capability: `app_runtime_config.require_card_for_trial` global toggle (default false for launch) + `trial_no_card_exemption_codes` manual-override codes, both wired into `stripe-create-checkout-session` with the location trial-reuse guard (`check_business_location_trial_reuse` / `deal_credit_periods`) applied to the automatic (code-less) path; `stripe-webhook` now marks `business_location_identity.trial_used_at` when a trial is confirmed. Needs Dan to deploy `stripe-create-checkout-session` + `stripe-webhook` and apply the migration |
| [06](findings/06-visual-redeem-honor-system.md) | Medium | PIN | Even with RLS fixed, `complete-visual-redeem` lets the customer's own device mark the claim redeemed after a 14s timer with no cryptographic proof staff were present. Confirm this is the intended trust model. | DONE (Option 1, Dan-confirmed) — code + migration written, needs Dan to deploy `complete-visual-redeem` + apply the migration |
| [07](findings/07-webhook-price-and-fallback.md) | Low | Stripe | The webhook's business path never re-verifies the Stripe price, and `businessAccessForStripeStatus` grants "active" on an unknown status when `cancel_at_period_end` is true. | DONE — code written, needs Dan to deploy `stripe-webhook` |

## What I verified is SOUND (do not "fix" these)

So the implementer doesn't waste credits or introduce regressions:

- **`stripe-webhook` signature/idempotency/livemode.** `constructEventAsync`
  verifies the signature; `enforceLivemode` + environment check reject
  cross-mode events; `billing_provider_events` has a unique constraint on
  `provider_event_id` and the handler dedupes duplicates and retries only
  `failed` rows. This is correct — do not loosen it.
- **`confirm_staff_redemption` RPC.** Atomic and idempotent: `FOR UPDATE` lock,
  `UPDATE ... WHERE redeemed_at IS NULL AND claim_status IN ('active','redeeming')`,
  and `INSERT INTO redemptions ... ON CONFLICT (claim_id) DO NOTHING`. Double-tap
  and replay safe. Leave it.
- **Staff redemption authorization + lockout.** `staff-redemption` requires a
  `redeemer` JWT, matches `business_id`, verifies the device is active, enforces
  location binding, and locks out at 10 failed guesses / 5 min per device. Solid.
- **Billing-table RLS.** `location_entitlements`, `deal_credit_periods`,
  `deal_credit_ledger`, `billing_accounts`, `business_subscriptions`, etc. all
  `REVOKE ALL FROM anon, authenticated` and grant writes only to `service_role`
  (reads gated by member/admin policies). A merchant cannot self-write these.
- **PIN storage.** PBKDF2-SHA256, 120k iterations, per-PIN salt, constant-time
  compare. Exit tokens are 32-byte random. Fine.
- **`simulate-subscribe`** is disabled (returns 410). Not a vector.
- **Owner PIN (`owner_redemption_security`) being client-side only** is
  intentional — the owner already fully controls their own deals, so the PIN is
  a device lock, not a server trust boundary. Do not add server PIN enforcement
  to `redeem-token` as a "fix."
- **`deal_claim_visible_to_business_owner`** is correctly scoped to
  `owner_id = auth.uid()`; no cross-merchant claim access.

## Notes / things I could not read

- I could not read the **live production RLS policy set** — only the migrations.
  Finding 02 depends on a `deal_claims` UPDATE policy that is *not in any
  migration in this repo* yet must exist in prod (otherwise `begin/complete-
  visual-redeem` and `release-claim` would be broken). Treat that as production
  drift and verify the live policy while fixing 02. Finding 04 asks you to dump
  the live grants/policies (`\dp` / `pg_policies`) as step one.
- I could not read the **Stripe Price/Dashboard config**, so I can't confirm
  whether the trial is embedded in the Price (Finding 05) or whether the webhook
  endpoint is subscribed to dispute events (Finding 03). Both findings state the
  Stripe-side config step explicitly.

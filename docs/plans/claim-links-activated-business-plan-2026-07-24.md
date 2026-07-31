# The claim LINKS an activated business instead of rewriting it (F-21 real fix)

**Date:** 2026-07-24
**Branch:** `qa/poster-ad-quality`
**Function:** `public.claim_approved_business_application_for_user(uuid, text)`

**Migrations (apply both, in order):**
1. `supabase/migrations/20260822170000_claim_links_activated_business.sql` — link-only branch + widened status list
2. `supabase/migrations/20260822180000_claim_deterministic_no_raise.sql` — removes every data-dependent 500 path

**Harness:** `scripts/db-tests/2i-claim-links-activated-business.mjs` (registered in `run.mjs`)

**Status:** ✅ **APPLIED TO PRODUCTION 2026-07-24 (Dan approved) and verified live.**
Proven on test first (19/19, zero regressions), then pushed to prod — only these two migrations were
pending. Post-apply on prod: `probe-rls-smoke` 7/7, `probe-merchant-surfaces` all pass, and
The Colonel's Brew's dashboard returns HTTP 200 with `business.status: trialing`,
`reason_code: active` and **every capability true** — a live business that went through the new
claim path without losing anything.
❌ **NOT committed. NOT pushed to git.**

---

## 1. Result in one paragraph

The claim now branches. If the business it resolves is already live — trialing, paying, comped or
lapsed — it stamps the linkage and stops: no rewrite of the business row, no billing write, no
entitlement write, no status reset. If the business is still in setup, behaviour is unchanged. With
the link path safe, the reverted F-21 widening is back. A second migration then removes every path
by which this function can fail a merchant's dashboard, because widening *which* rows match also
widened two pre-existing crash paths — one of which production data can already reach.

---

## 2. The two failures this closes

Both come from the same function, and they are opposites — which is why fixing one made the other
worse and got reverted on 2026-07-24.

**LOCKOUT.** An application that advanced to an active-looking status before its owner first signed
in matched no branch of the claim. The RPC returned nothing, the dashboard saw `business: null`, and
the merchant was told *"Business setup opens after your application is approved"* — permanently —
while the enforcement side considered them fully active.

**DOWNGRADE.** An application still sitting at `approved_not_activated`, whose business had already
been activated by another path (admin comp grant, Stripe webhook), *did* match. The claim then
rewrote `businesses.status` and `access_level` back to `approved_not_activated`.

The downgrade matters more than a relabelled row, because `get_business_capabilities`
(`20260817120000`) evaluates setup access **first** and defines active access as *"NOT setup
access"*:

```sql
v_setup_access  := ... business.status = 'approved_not_activated'
                    OR business.access_level = 'approved_not_activated'
                    OR subscription.app_access_status = 'approved_not_activated';
v_active_access := NOT v_suspended AND NOT v_setup_access AND ( ...trial/paid/comped... );
```

One UPDATE switched off publishing, AI and new claims for a live business. Captured on test, same
business, before and after a single claim call:

| | `reason_code` | `can_generate_ai` | `can_consume_offer_credits` | `can_redeem_existing_claims` |
|---|---|---|---|---|
| before | `active` | ✅ true | ✅ true | ✅ true |
| after (old function) | `approved_not_activated` | ❌ **false** | ❌ **false** | ❌ **false** |

It also overwrote the merchant's business name with the one from their months-old application form.

---

## 3. What the fix does (`20260822170000`)

A derived flag, `v_already_activated`, computed subscription-first (the billing source of truth
`get_business_capabilities` itself reads), with `businesses.access_level` / `status` as a secondary
signal for comped and drifted rows.

**When false** — behaviour is byte-identical to `20260822160000`. The normal onboarding path, just
fixed and verified in prod, does not move.

**When true** — the claim stamps and stops:

| Action | Activated business |
|---|---|
| `business_applications` id stamp | ✅ done — this is the point |
| owner `business_members` row | ✅ ensured |
| `business_profiles` | ✅ created if missing, **never overwritten** |
| `businesses` status / access_level / name / address | ⛔ untouched |
| `business_subscriptions` | ⛔ untouched |
| `location_entitlements`, `business_locations` | ⛔ untouched |
| `business_onboarding_requests.status` | ⛔ untouched (only linkage columns set) |
| `business_applications.access_tier` reset | ⛔ preserved |
| `business_billing_profiles.billing_email` / `billing_contact_name` | ⛔ preserved (only `billing_contact_user_id` is stamped) |

**The widening.** The fresh-claim predicate now also accepts the four active-looking statuses
`admin-dashboard-summary:690` recognises — `trial_active`, `trial_limited`, `approved_not_billed`,
`active`. (The same four that `get-business-onboarding-context:65` maps to a reported `"pending"`.)

---

## 4. The hardening (`20260822180000`) — and why it was needed

Widening *which* rows match also widened two pre-existing crash paths. Both surface to the merchant
as **HTTP 500**, because `get-business-onboarding-context` rethrows any RPC error
(`if (atomicClaimError) throw atomicClaimError`).

### 4.1 Ambiguity raise

`AMBIGUOUS_APPROVED_APPLICATION_EMAIL` fired when an email had more than one *unclaimed* matching
application. Previously only `approved_not_activated` rows counted; after the widening, five
statuses do. Nothing prevents multiple applications per email — there is no uniqueness on it and the
apply flow deliberately permits re-applying.

### 4.2 Unique violation — production can already reach this one

`business_applications` carries `UNIQUE (claimed_by_user_id) WHERE claimed_by_user_id IS NOT NULL`.
The already-claimed branch only returned early when the claimed application still had a
`business_id`. A user whose claimed row lost its business fell through to the fresh-claim path,
which would stamp a **different** application with the same `claimed_by_user_id` and abort the whole
transaction.

Production holds exactly this shape today: `unvmex2@hotmail.com` has a **claimed** `trial_active`
application *and* an **unclaimed** `trial_limited` one. Reproduced on test against the un-hardened
function: **HTTP 409, unique violation.**

### 4.3 What changed

- The already-claimed branch matches any application this user has claimed, with or without a
  `business_id`, and returns it. A user's claim is decided exactly once, so the fresh-claim path can
  never stamp a second row. (Falling through was never useful — the fresh-claim path filters on
  `claimed_by_user_id IS NULL`, so it could only ever match a *different* row.)
- Both branches select with a total `ORDER BY … LIMIT 1` instead of counting and raising. The
  ordering is preference-ranked and stable: `approved_not_activated` first (so behaviour is
  unchanged whenever such a row exists — the widened statuses are strictly a fallback), then an
  application already pointing at a business this user owns, then any with a `business_id`, then
  oldest `created_at`, then `id`.
- Both `AMBIGUOUS_*` raises are gone. A 500 helps nobody: it leaves a dead dashboard with no way
  forward, while the situation is always resolvable by picking a row. The owner-conflict guard is
  untouched, so a pick can still only ever link a business this user owns or one with no owner.

**Remaining raises, and why they stay:** `claim requires user and email` (caller contract, not
data); `CONFIRMED_AUTH_EMAIL_REQUIRED` (a security check — failing loudly is correct, and it is
unchanged from today); `APPROVED_APPLICATION_BUSINESS_OWNER_MISMATCH` (unreachable defence-in-depth,
kept as a tripwire).

---

## 5. Proof

### 5.1 Written to run against the old function first — so the "before" run *is* the repro

Against `20260822160000` (what prod runs now):

```
FAIL  S3a a trialing merchant whose application advanced can claim their workspace — returned=NOTHING
FAIL  S3a the claim stamps the application instead of leaving it unclaimed — claimed_by=null
FAIL  S3b claiming a live business does NOT switch off its capabilities
FAIL  S3b the business row keeps its live status and access level — status=approved_not_activated
FAIL  S3b the merchant's own business name survives the claim — name=Claim Link S3b
```

Against `20260822170000` (link-only, before hardening) the two crash shapes reproduce:

```
FAIL  S8 two matching applications resolve instead of failing the dashboard — HTTP 400 AMBIGUOUS_APPROVED_APPLICATION_EMAIL
FAIL  S9 a user who already claimed never has a second application stamped — HTTP 409
```

### 5.2 After both migrations

```
[2i claim links activated business] 19 passed, 0 failed, 0 skipped
```

| Shape | Result |
|---|---|
| S1 new business materializes | ✅ unchanged |
| S2 existing **inert** business linked and filled in | ✅ unchanged |
| S3a trialing merchant can now claim | ✅ **fixed** |
| S3b live business keeps capabilities, status, billing and name | ✅ **fixed** |
| S4 comped business keeps its comp | ✅ (already safe pre-fix) |
| S5 a stranger's business is never handed over | ✅ authorization unchanged |
| S6 idempotent | ✅ |
| S7 already-claimed returns early | ✅ |
| S8 two matching applications resolve, stably, preferring the setup row | ✅ **no 500** |
| S9 claimed-without-business never stamps a second row | ✅ **no 500** |

### 5.3 No regressions

Full `npm run test:db`, identical across every pre-existing suite before and after:

| Suite | Before | After |
|---|---|---|
| 2a purge_user_data | 12 / 0 / 2 skip | 12 / 0 / 2 skip |
| 2b role enforcement | 15 / 0 | 15 / 0 |
| 2c cross-tenant RLS | 8 / 1 | 8 / 1 |
| 2d billing-token consume | 14 / 0 | 14 / 0 |
| 2e claim + visibility + publish gate | 12 / 1 | 12 / 1 |
| 2f business name lock | 6 / 3 | 6 / 3 |
| 2h promo materials | 21 / 0 | 21 / 0 |
| **2i (new)** | — | **19 / 0** |

2c / 2e / 2f failures are pre-existing and documented (F-19 plus the known `businesses` grant drift
on a migrations-only database). Baseline: `typecheck` ✅ · `lint` ✅ · `npm test` ✅ 1946 tests.

---

## 6. Production impact

Read from prod on 2026-07-24 (grouped by claim email):

| email | unclaimed matching | statuses | effect of applying |
|---|---|---|---|
| `test2@test.com` | 1 | `[trial_active]` | 🎯 **currently locked out — this is the merchant the fix frees** |
| `unvmex2@hotmail.com` | 1 | `[trial_limited, trial_active]` (2nd claimed) | already-claimed branch returns early; **§4.2 is the shape that made hardening mandatory** |
| `support+business-smoke-…` | 0 | `[rejected]` | never matches, unchanged |
| `test3@test.com` | 0 | `[approved_not_activated]` (claimed) | already-claimed branch, unchanged |

No email has 2+ unclaimed matching applications, so the ambiguity path would not fire against
today's data — but data changes, which is why it is now impossible rather than merely unlikely.

**The installed AAB is unaffected.** Function body only: no tables, columns, policies, grants,
indexes, or data backfill, and it modifies no existing row on its own. The app cannot call this
function — `REVOKE ALL … FROM PUBLIC, anon, authenticated`, execute granted only to `service_role`.
There is exactly one caller in the codebase, `get-business-onboarding-context/index.ts:94`, and the
signature and return shape are unchanged, so no edge-function redeploy and no app rebuild are needed.

---

## 7. Corrections to my own earlier analysis

Each would have sent the fix in the wrong direction.

1. **The test project was already fully up to date** — every migration through `20260822160000`. The
   planned resync was unnecessary.
2. **`probe-rls-smoke.mjs` and `probe-merchant-surfaces.mjs` read `.env` / `.env.development.local`,
   which point at PRODUCTION.** I had listed them as test-phase verification. They are prod tools.
3. **The drift is `access_level = 'none'`, not NULL** — that column is NOT NULL, so the shape I first
   hypothesised cannot exist.
4. **Comped businesses were already safe.** S4 passes against the *old* function. The harm was
   specific to the drifted-trialing shape.
5. **A silently-rejected fixture row nearly produced a false pass.** Two `business_subscriptions`
   seeds were being rejected (`activated_at` requires its provenance columns; `billing_mode: 'admin'`
   and `billing_status: 'comped'` are invalid). The suite now fails loudly on any rejected insert.
6. **The widening introduced two 500 paths I did not anticipate** (§4). Found only by asking what
   the change did to *existing* production data rather than to the fixtures.

---

## 8. Side finding — not fixed, not in scope

**`get_business_capabilities` returns NULL for most `can_*` flags when a business has no
`business_subscriptions` row.** With no subscription, `v_setup_access` evaluates under three-valued
logic to NULL and every dependent flag follows:

```json
{"reason_code":"terms_required","can_generate_ai":null,"can_use_setup_tools":null, ...}
```

It **fails closed** — `=== true` checks treat null as no-access — so this is a P2 robustness smell,
not a hole. A `SECURITY DEFINER` enforcement gate returning NULL instead of a boolean deserves a
deliberate `COALESCE(…, false)` at some point. Flagged, not touched.

---

## 9. What is still open

| # | Item | Gate |
|---|---|---|
| 1 | ✅ **DONE — applied to production 2026-07-24** and verified (see §9.1) | — |
| 2 | **Commit** — 2 migrations, the 2i suite, the `run.mjs` registration, this doc | Dan — commit request |
| 3 | **Confirm `test2@test.com`'s merchant** once they next open the app (§9.2) | passive |
| 4 | Dev APK on the test project | Deferred by decision — §10 |

### 9.1 What the prod apply did

`npx supabase db push --linked` — only `20260822170000` and `20260822180000` were pending; the
list was checked against prod before pushing. Both applied cleanly.

Verified immediately after:

- `node scripts/probe-rls-smoke.mjs` → **7/7 pass**
- `node scripts/probe-merchant-surfaces.mjs` → **all pass**, including
  `get-business-onboarding-context loads for the owner — HTTP 200` and the non-owner cross-tenant denial
- Live merchant dashboard for The Colonel's Brew (`unvmex2@hotmail.com` — the account holding the
  claimed + unclaimed application pair, i.e. the S9 shape that returned **409** against the
  un-hardened function): `business.status: "trialing"`, `access_state.reason_code: "active"`, and
  **all twelve `can_*` flags true**. The live business went through the new claim path and kept
  everything.

**Rollback, if ever needed:** re-apply `20260822160000`. Function body only — nothing to unwind.

### 9.2 Still to observe: `test2@test.com`

The claim only runs when a merchant loads their dashboard, so this account's `trial_active`
application stays unclaimed until they next open the app. Re-running the grouped application query
afterwards should show it flip to claimed, with its business state unchanged. Nothing to do until
then — no action is required from that merchant beyond signing in.

---

## 10. Deferred: dev APK against the test project

Decided this session: prove it on the test DB, skip the device pass. Two blockers stand whenever it
is picked up:

- **`.env.development.local` points at PRODUCTION** (same project ref as `.env`), so a dev APK built
  today talks to prod — which also contradicts `CLAUDE.md`'s rule that dev builds use a separate
  Supabase project. Worth fixing on its own merits.
- **The test project has only a subset of edge functions deployed.** `get-business-onboarding-context`,
  `get-business-capabilities`, `business-apply` and `stripe-create-checkout-session` all return
  `404 NOT_FOUND`; `delete-user-account` returns 401, so it is there.

Picking it up also unblocks **K8** (military-brand image generation), which was blocked behind
F-21's `can_generate_ai: false`.

---

## 11. Ledger

- Closes **F-21** in `docs/plans/pre-launch-rare-feature-qa-plan-2026-07-24.md`.
- Builds on **F-23** (`20260822160000`) and **F-24** (`20260822150000`), both live in prod.
- Supersedes the reverted `20260822120000` / `20260822130000` pair.
- New side finding for the QA log: NULL capabilities with no subscription row (§8).

# Admin approval error + "full access without Stripe" option — plan, 2026-07-23

**Status: PLAN ONLY. Nothing here is implemented.** Investigation was read-only.

## What Dan hit

Approving the "QA TEST Diner" request on www.twoferapp.com/admin → **error**. The page also shows a red banner: **"Approved activation rollout is not enabled."**

## Root cause (confirmed from code)

Every approve decision is gated behind a feature flag `approved_activation_gate` that is **shipped OFF**:

- The flag row is created with `enabled = false` in migration `20260817120000_approved_not_activated_activation_gate.sql:310-320`.
- `admin-business-applications/index.ts:243-251` reads it (`approvedActivationGateEnabled`); when off, the approve path returns HTTP with `error: "Approved activation rollout is not enabled."`, `error_code: "APPROVED_ACTIVATION_GATE_DISABLED"` (lines 645-647 and 1118-1120). Same gate in `admin-trial-create-from-prospect` and `stripe-create-checkout-session`.

So approvals are blocked until the flag is enabled in prod. This is the whole error.

## How approval works today (verified)

- Admin UI (`website/admin/trial-requests/index.html` + `trial-requests.js`) is the "Business Access Requests" page. It sends only these decisions (trial-requests.js:282-287): `ai_review`, `approve_setup`, `review_required`, `waitlist`, `reject`, `suspend`. It does **not** expose `approve_full` or any comp option.
- `decisionConfig()` (admin-business-applications/index.ts:128-160): **`approve_setup`, `approve_limited`, AND `approve_full` all set the business to `approved_not_activated`.** The only difference is `businessVerificationStatus` (basic_verified vs manual_verified). None of them grant working access.
- `approved_not_activated` = owner can finish profile/menu, but **AI, publishing, credits, and new claims all wait for Stripe Checkout** (this is exactly the "Approved for setup / Activate 30-day trial" card already live in the app).
- On approval, `sendApprovalEmail` (admin-business-applications/index.ts:715) sends the trial-welcome email that **always** mints a single-use checkout token and links to secure Stripe Checkout (`_shared/approval-email.ts` — "Your N-day business trial starts after you activate it through secure Checkout"). Email + Stripe link are already wired; they just never fire because the gate blocks the decision first.
- The only no-Stripe grant that exists is the `admin_grant_location_trial(location_id, admin_user_id, reason, override)` RPC (migration 20260726120000) — used manually for QA, not wired to any admin button, and it needs an already-materialized business + location.

## Is Dan thinking about this correctly? — Yes.

Two distinct approval outcomes make sense, and only the first exists today:

- **(A) Approve → require Stripe** (the default for real merchants): approval opens setup; full access starts after the owner completes secure Checkout. This is the current `approved_not_activated` model — it just needs the flag on.
- **(B) Approve → grant full access now, no Stripe** (comps, partners, pilot fast-tracks, Dan's own test accounts): approval directly activates the business without a payment step, and the email says "you're all set" with no checkout link.

Today there is no (B) at the admin-decision level, and (A) is switched off. The plan delivers both.

---

## Phase 0 — Unblock approvals (the immediate fix)

Goal: make the existing Stripe approval path (A) work, which resolves Dan's error.

1. **Verify prod readiness (read-only) before flipping anything:**
   - Confirm migration `20260817120000` schema objects actually exist in prod (the businesses/subscriptions/entitlements/`feature_flags` machinery it creates). `supabase migration list` needs the DB password and prod has known migration-drift history, so verify by object existence, not just the migration ledger.
   - Confirm the `feature_flags` row `approved_activation_gate` exists.
   - Confirm `RESEND_API_KEY` is set (it is — verified this session), `app_runtime_config.purchase_surface = web_only`, and `billing_environment` (test vs production) — the email checkout link only sends when purchase_surface allows the `source:"email"` path.
2. **Enable the flag in prod:** `UPDATE public.feature_flags SET enabled = true WHERE key = 'approved_activation_gate';` — **Dan-gated** (this is a production rollout switch that turns on the approved_not_activated model end-to-end).
3. **Reproduce + confirm** the exact error is gone: approve a throwaway test request → expect `approved_not_activated`, a welcome email delivered, and a working Stripe Checkout link (in Stripe TEST mode first). Do this with a disposable application so it doesn't pollute real data.
4. Risk check: enabling the flag affects only NEW approvals + checkout; it does not retroactively change existing businesses. Low risk, reversible (flip back to false).

Phase 0 alone gets Dan approving again on the website, with email + Stripe link.

## Phase 1 — Add "Approve — full access (no Stripe)" (option B)

### Server (`admin-business-applications/index.ts`)
- Add a new decision key, e.g. `approve_full_access` (distinct from the existing `approve_full`, which is misleadingly still just approved_not_activated — consider renaming `approve_full` → `approve_setup_verified` to remove the confusion).
- Its `decisionConfig` grants a working, **time-boxed trial** (not `approved_not_activated`): set the trial state with `trial_ends_at = now + N days` where N is the admin's day-count input (`trial_days`, 1–120). Use the granting values already used elsewhere (e.g. `full_trial`/`trialing`, or `admin_trial_active`). Access is live immediately; Stripe is offered for conversion, not required for access.
- Two materialization cases (the business often does not exist at approval time — `business_id` is NULL until the owner claims it via `claim_approved_business_application_for_user`):
  - **Business exists:** grant directly (reuse `admin_grant_location_trial` on the primary location, or set the subscription to the comped/trialing state via the same helpers the activation gate migration uses).
  - **Business not yet claimed:** mark the application as comp-granted so the claim/materialization path activates full access on first owner login **instead of** `approved_not_activated`. This touches the seeding logic in migration 20260817120000 / `claim_approved_business_application_for_user`.
- New audit action (e.g. `admin_business_application_approved_full_access_comp`) for the audit log.
- Guardrail: consider restricting the comp decision to owner-admins (`is_owner_admin()`), since it bypasses payment.

### Email (`_shared/approval-email.ts`)
- Add a **path-B variant**: welcome + "your business is **live now** with N days of full access" + the secure Checkout link to add payment before the trial ends (still mint the checkout token — path B converts to paid). Keep the idempotency + never-throw contract. Select the variant by decision type; interpolate the day count.

### Admin UI (`website/admin/trial-requests.js` + page)
- Add an **"Approve — full access"** button next to "Approve for setup", plus a **"Trial days" number input** (the countdown length). On click, send the new decision with `trial_days` = the box value; confirm dialog ("Grant N days of full access now, no payment required yet?").
- Validate the day count client- and server-side (1–120 per the business_applications constraint).
- Optionally surface which businesses are on an admin-granted trial vs Stripe-activated in the Businesses admin view.

### Respect locked decisions
- Pilot 1-location cap still applies to comped businesses.
- Comp should not permanently block future billing — a comped business can still add Stripe later (comp → paid conversion) — confirm the billing state model allows this.

## Validation & gates

- `npm run typecheck:functions`; update/extend `approved-activation-gate-source.test.ts` and `business-billing-access-sync-source.test.ts` for the new decision + email variant.
- Billing/RLS-sensitive: run focused billing tests and `node scripts/probe-rls-smoke.mjs` after any migration touching RLS/policies.
- QA in Stripe TEST mode for path A; QA the comp path end-to-end on the S10 (approve full-access → app opens full access with no checkout).
- **Dan-gated:** enabling the flag (Phase 0), applying any new migration, deploying `admin-business-applications` / `admin-trial-create-from-prospect` / `stripe-create-checkout-session` / `get-business-onboarding-context`, deploying the website, and any change to Stripe/billing config.

## Decisions (resolved by Dan, 2026-07-23)

1. **Phase 0 first, then build Phase 1.** Enable `approved_activation_gate` in prod to unblock path A (the real fix for today's error), then build path B.
2. **Path B is a time-boxed full-access grant with an admin-entered day count that counts down, AND it still sends the Stripe link.** The admin types the number of days into a box on the full-access approval; the business gets **full working access immediately** (not `approved_not_activated`) with a trial that expires after N days; the welcome email is sent **with** the Stripe Checkout link so they can add payment / convert to paid. So path B differs from path A in *when* access turns on (immediately vs after Checkout), not in whether Stripe is offered.
   - Implication: the day-count input drives `trial_days` → `trial_ends_at = now + N days`. Reuse the `admin_grant_location_trial` machinery (it already grants a dated trial with credits, no card). Constraint: `trial_days` 1–120 (business_applications check) — surface a validation message if out of range.
3. **Comp/full-access businesses can convert to paid via Stripe** (that's why the link is sent in #2). Not terminal.
4. **Rename `approve_full`** → an honest name (e.g. `approve_setup_verified`), since today it is only `approved_not_activated` with manual verification, not real full access. The new real grant gets its own decision key (e.g. `approve_full_access`).

### Path B email note (updated)
Not a "no-checkout" email after all — path B's welcome email says "you're **live now** with N days of full access" **and** includes the secure Checkout link to add payment before the trial ends. Path A's email keeps its "activate via Checkout to start your trial" framing. Both mint the checkout link; the copy and the access timing differ.

## Open question to resolve during Phase 0

Confirm the *exact* failure Dan saw is the gate (near-certain from the banner + code) and not a second issue behind it (email send / checkout mint). Reproduce with a disposable request in Stripe TEST mode.

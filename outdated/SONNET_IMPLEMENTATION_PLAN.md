# Implementation plan for Sonnet 5 — Twofer money & trust fixes

Read this top to bottom before touching anything. It sequences the seven
findings, bakes in Dan's confirmed decisions, and marks the exact points where
you must **stop and hand back to Dan** (applying migrations and deploying edge
functions are hard-gated in this repo — you never do them yourself).

Each phase points at a finding file under `findings/` for the detailed fix.
Findings 01, 02, and 03 contain the complete, final code — implement it as
written. Findings 04–07 are specs; write the code from the spec.

---

## Ground rules (do not violate)

- **You may:** create/edit migration `.sql` files, edit edge-function source
  under `supabase/functions/`, edit shared modules, add/adjust tests, run local
  validation.
- **You may NOT** (these are CLAUDE.md hard gates — stop and leave for Dan):
  - Apply any migration / run `supabase db push`.
  - Deploy any edge function to a hosted project.
  - Change production Supabase/Stripe secrets or Stripe Dashboard config.
  - Push, merge, tag, or reset branches. Commit only if Dan explicitly asks;
    make one scoped commit per phase when he does.
- **One scoped change at a time.** Do the phases in order. State the phase and
  the one-line plan before you start it.
- **Preserve untracked artifacts.** This tree has local QA folders and WIP
  patches; never delete them.
- **Migration file naming:** new migrations must sort *after* the latest
  existing one (`20260803122000_...`). Use strictly-greater UTC-style stamps,
  e.g. `20260804120000_lock_businesses_server_columns.sql`,
  `20260804121000_lock_down_deal_claims_client_writes.sql`, etc. Keep one
  logical change per migration file.
- **NULL-safety rule (from a prior prod RLS lockout incident):** any boolean
  used in a policy/trigger predicate must not be able to evaluate to NULL and
  silently change behavior. Wrap helper calls: `COALESCE(public.is_admin(),
  false)`, `COALESCE(auth.role(),'')`. See Phase 1.
- **After each phase**, run the validation listed for it. If a required check
  can't run, say exactly why.

## Baseline validation (run once before you start, and re-run per phase)

```
npm run typecheck
npm run lint
npm test
npm run typecheck:functions
```
For the RLS/billing phases also run the focused edge-function/source tests that
already exist under `supabase/functions/_shared/*.test.ts` (e.g. the billing and
redemption source tests). The live RLS smoke probe
(`node scripts/probe-rls-smoke.mjs`) is **Dan's** post-apply step — you cannot
run it (no prod access), but call it out in your handoff.

---

## Phase 0 — Read-only recon (no writes)

Purpose: the repo is not a faithful mirror of prod, and two fixes depend on the
live state. Gather facts first; write a short `findings/00-recon-notes.md` with
the answers.

1. Confirm the `deal_claims` drift policy (Finding 02). Ask Dan to run, or note
   that Dan must run, against prod:
   ```sql
   select policyname, cmd, qual, with_check
   from pg_policies where schemaname='public' and tablename='deal_claims';
   select table_name, privilege_type, grantee
   from information_schema.role_table_grants
   where table_schema='public' and table_name='deal_claims'
     and grantee in ('anon','authenticated');
   ```
2. Same two queries for `businesses` (Finding 01) and, for Phase 4, for `deals`,
   `business_locations`, `business_profiles`, `favorites`, `consumer_profiles`,
   `push_tokens`.
3. Re-confirm the client makes no direct writes to the money tables:
   ```
   grep -rn "from('deal_claims')" app lib hooks components
   grep -rn "from('businesses')"  app lib hooks components
   ```
   Both should show reads only (they did at audit time). If a write appears,
   note it — it changes the revoke-vs-trigger choice for that table.
4. **Question for Dan (blocks Phase 5 correctness):** is the Stripe trial
   embedded in the Price, or is every checkout an immediate paid charge? If the
   latter, Phase 5 is a no-op. Record the answer.

Do not modify anything in this phase.

---

## Phase 1 — Critical RLS fixes (Findings 01 + 02)

Do these two together; they are the top of the risk list.

### 1a. `businesses` self-grant — Finding 01

- Add migration `20260804120000_lock_businesses_server_columns.sql` with the
  `enforce_businesses_protected_columns()` trigger **exactly as written in
  Finding 01**.
- Apply the NULL-safety rule to the bypass line:
  ```sql
  v_privileged boolean :=
    (COALESCE(auth.role(),'') = 'service_role') OR COALESCE(public.is_admin(), false);
  ```
- Verify the frozen-column list against the live `\d public.businesses` from
  Phase 0. At minimum freeze `owner_id, access_level, status, can_publish_cached,
  is_demo`. Leave `repeat_claim_policy_type` / `repeat_claim_cooldown_days`
  client-editable (Finding 01 note).
- Do **not** solve this with RLS `WITH CHECK` or a partial column GRANT — see
  Finding 01 "Do NOT".

### 1b. `deal_claims` self-redeem — Finding 02

**Sequencing hazard — read this.** The migration `REVOKE`s client writes on
`deal_claims`. If it lands before the edge functions stop using the user client
for claim writes, `redeem-token` / `begin-visual-redeem` /
`complete-visual-redeem` / `release-claim` break. So:

1. First edit the edge functions to write via the **service-role** client
   (`supabaseAdmin`), per the precise per-file, per-line list in Finding 02
   ("Step 1"). `begin-visual-redeem`, `complete-visual-redeem`, and
   `release-claim` need a `supabaseAdmin` client added; `redeem-token` already
   has one. Move only the **writes** and the `finalizeStaleVisualRedeemForClaim`
   calls; leave the ownership SELECT + the `claim.user_id !== user.id` code
   check in place (with service role, that in-code check is now the only thing
   scoping the write — do not remove it).
2. Then add migration `20260804121000_lock_down_deal_claims_client_writes.sql`
   with the `REVOKE INSERT, UPDATE, DELETE ... FROM anon, authenticated` and the
   two `DROP POLICY IF EXISTS` lines from Finding 02 "Step 2". Keep the SELECT
   policies.
3. In your handoff, tell Dan the **deploy order is: edge functions first, then
   the migration** (deploying functions first is safe; applying the migration
   first would break redemption until the functions ship).

### Phase 1 validation

- `npm run typecheck && npm run typecheck:functions && npm run lint && npm test`.
- Add/extend a unit or source test asserting: (a) the four claim-writing
  functions reference `supabaseAdmin` for their `deal_claims` writes; (b) the
  new migration text contains the `REVOKE` and both `DROP POLICY` lines. (There
  are precedent source-assertion tests in `supabase/functions/_shared/*.test.ts`
  — follow that style.)
- Hand off to Dan: after he applies each RLS migration he must run
  `node scripts/probe-rls-smoke.mjs`, plus the manual PATCH repros in Findings
  01 and 02 "How to verify".

---

## Phase 2 — Chargebacks (Finding 03)

- Implement the `charge.dispute.created` handler in `stripe-webhook/index.ts`
  exactly as specified: add `forceChargebackSuspend` to
  `syncBusinessSubscriptionFromStripe`, resolve the customer id from the dispute's
  charge/payment_intent so `businessId` populates, and add the dispatch branch.
- **Decision baked in (Dan confirmed): NO auto-restore.** You may subscribe to
  `charge.dispute.closed` for logging only; its handler must never move access
  back to active. Do not write a "restore on won" branch.
- Validation: `npm run typecheck:functions`, plus the webhook source tests.
- Handoff to Dan (his actions): subscribe the webhook endpoint to
  `charge.dispute.created` (and `.closed` if logging) in the Stripe Dashboard,
  and run the test-mode dispute repro in Finding 03.

---

## Phase 3 — Column-write hygiene sweep (Finding 04)

Uses the Phase 0 dumps. For each owner-owned table with server-meaningful
columns, apply the Finding 01/02 pattern:

- **Column-freeze trigger** where the client legitimately edits other columns
  (`deals`, `business_locations`, `business_profiles`).
- **`REVOKE` + service-role writes** where the client makes no direct writes.

Priority target: `deals` — confirm whether a client can PATCH
`deal_status='LIVE', eligibility_status='VALID', is_active=true` to publish a
weak/ineligible deal, and whether the existing triggers
(`deals_block_suspended_location_write`, strong-deal guard) already block it. If
not, freeze those columns for non-service/non-admin callers.

Add a regression probe/test that fails if `anon`/`authenticated` regain
`INSERT`/`UPDATE` on the protected columns. Validation as in Phase 1. This phase
is larger and lower-severity than 1–2; if credits run short, stop after the
`deals` table and leave the rest enumerated for a follow-up.

---

## Phase 4 — Trial reuse guard (Finding 05)

Only meaningful if Phase 0 confirmed the Price has an embedded trial.

- **Decision baked in (Dan confirmed): scope = per physical location.** Key the
  guard on the primary `business_locations` identity via
  `business_location_identity.trial_used_at` /
  `check_business_location_trial_reuse(...)`.
- **Reuse behavior:** use recommended default **(b)** — allow the checkout but
  suppress the trial (`subscription_data.trial_end: "now"`) so a returning
  customer is charged immediately with no second free month. Put the
  block-vs-convert choice behind a single clearly-commented branch so Dan can
  switch it to a hard `409 TRIAL_ALREADY_USED` later.
- Implement in `stripe-create-checkout-session/index.ts` before
  `stripe.checkout.sessions.create`.
- Validation: `npm run typecheck:functions` + checkout source tests + the
  test-mode cancel/re-checkout repro in Finding 05.

---

## Phase 5 — Visual-redeem hardening (Finding 06)

- **Decision baked in (Dan confirmed): Option 1** — keep customer-completed
  visual redeem for the pilot, but (a) bind completion to the store: record
  `redeemed_at_location_id` and reject completion when a client-supplied location
  mismatches the deal's `location_id` (mirror the `WRONG_LOCATION_REDEMPTION`
  check in `redeem-token`); and (b) write a `redemptions` audit row on visual
  completion so staff/owner/visual redemptions share one trail.
- Implement in `complete-visual-redeem/index.ts`. The `redemptions` insert
  should mirror `confirm_staff_redemption`'s shape with a `redeem_method`/
  `code_type` that marks it visual, and use `ON CONFLICT (claim_id) DO NOTHING`
  for idempotency. Do **not** implement Options 2/3.
- Do this after Phase 1 (the actual security bug lives in Finding 02); this
  phase only raises the trust level of the intended flow.
- Validation: `npm run typecheck:functions` + the visual-redeem repro in
  Finding 06.

---

## Phase 6 — Webhook hardening (Finding 07, Low)

- Add `assertExpectedPrice` to `syncBusinessSubscriptionFromStripe` only when
  about to grant access on `active`/`trialing`.
- Make `businessAccessForStripeStatus` fail closed: unknown status →
  `appAccessStatus: "pending"` regardless of `cancel_at_period_end`; keep all
  explicit branches intact.
- Validation: unit test the fallback + `npm run typecheck:functions`.

---

## Final handoff checklist (what only Dan can do)

Produce this list at the end so Dan can finish the rollout:

1. Apply the new migrations **in filename order**, and for the `deal_claims`
   one, **only after** the Phase 1b edge functions are deployed.
2. Deploy the changed edge functions: `redeem-token`, `begin-visual-redeem`,
   `complete-visual-redeem`, `release-claim`, `stripe-webhook`,
   `stripe-create-checkout-session`, and any others touched.
3. After each RLS migration: `node scripts/probe-rls-smoke.mjs`.
4. Run the per-finding "How to verify" repros (the direct-PATCH tests for 01/02
   are the important ones — they must now fail).
5. Stripe Dashboard: subscribe the webhook endpoint to `charge.dispute.created`
   (Finding 03).
6. Confirm the Stripe Price/trial config question from Phase 0 (Finding 05).
```

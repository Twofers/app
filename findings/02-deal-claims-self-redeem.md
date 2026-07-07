# Finding 02: Customer can self-redeem and re-redeem claims by writing `deal_claims` directly

Severity: Critical
Surface: RLS / PIN redemption
Files:
- Production `deal_claims` UPDATE policy for end users — **not present in any repo migration** (drift; see below)
- `supabase/functions/begin-visual-redeem/index.ts:28,141-148` (writes claim via the user client)
- `supabase/functions/complete-visual-redeem/index.ts:31,165-178` (writes claim via the user client)
- `supabase/functions/release-claim/index.ts:23,118-127` (writes claim via the user client)
- `supabase/functions/redeem-token/index.ts:81-91,457,480-495` (owner redeem writes via the user client)
- `supabase/functions/_shared/claim-redeem.ts:24-72` (`finalizeStaleVisualRedeemForClaim`, writes via whatever client it is handed)
- `supabase/migrations/20250127000000_initial_schema.sql:143-152` (business-owner UPDATE policy, later moved to `deal_claim_visible_to_business_owner`)
Status: NOT STARTED

## What is wrong

`begin-visual-redeem`, `complete-visual-redeem`, and `release-claim` all UPDATE
`deal_claims` using the **user-scoped, RLS-enforced client** (`supabase`, built
with the caller's JWT). There is **no** end-user UPDATE policy on `deal_claims`
in any migration in this repo — only a business-owner policy
(`deal_claim_visible_to_business_owner`). For those three customer-facing
functions to work at all in production, an end-user UPDATE policy on
`deal_claims` (something like `USING (auth.uid() = user_id)`) **must exist in
prod but was applied out-of-band** (drift — consistent with other hand-applied
prod changes noted in the repo's memory).

Whatever that policy is, `authenticated` also retains Supabase's default
table-level UPDATE grant on `deal_claims` (never revoked). So the customer can
skip the edge functions entirely and PATCH their own claim row through
PostgREST. Because RLS `WITH CHECK` cannot constrain *which* columns or *which
status transitions* a row undergoes, the naive `auth.uid() = user_id` policy
lets the customer write `redeemed_at`, `claim_status`, `redeem_method` — and
even reverse a redemption.

## Exploit or failure path

Assume the prod policy is the natural `USING (auth.uid() = user_id) WITH CHECK
(auth.uid() = user_id)`.

**A. Self-redeem with no staff, no timer, no location check.** The intended
flow makes the customer wait ~14s (`begin`→`complete`) while staff watch, or
staff scan the QR. Instead:

```
PATCH /rest/v1/deal_claims?id=eq.<own_active_claim>
Authorization: Bearer <customer JWT>
{ "claim_status": "redeemed", "redeemed_at": "2026-07-06T12:00:00Z", "redeem_method": "visual" }
```
Passes RLS (they own the row). The claim is now "redeemed" instantly; the
customer shows the redeemed screen to staff and collects the reward. No staff
device, no PIN, no `redemptions` audit row, no location binding.

**B. Un-redeem and redeem again (unlimited free rewards).** Worse, because the
policy does not forbid the `redeemed → active` transition:

```
PATCH /rest/v1/deal_claims?id=eq.<own_redeemed_claim>
{ "claim_status": "active", "redeemed_at": null }
```
The CHECK constraint `deal_claims_redemption_audit_check` is satisfied
(`claim_status <> 'redeemed'`), and the partial unique index only limits *one
active claim at a time* — it does not stop reactivation. The customer can now
redeem the same claim again, repeating for a free 2-for-1 on every visit from a
single claim. This directly defrauds the merchant and violates INV-1/INV-2.

(If the prod policy turns out to be more restrictive than assumed, path B may
be blocked, but path A is enabled by any policy that lets the user set
`redeemed_at` — verify the live policy as step one.)

## The fix

Root cause: customer claim writes run through the RLS user client and thus need
a client UPDATE grant/policy that is impossible to make transition-safe with
RLS alone. Fix by moving **every** `deal_claims` write to the service-role
client inside the edge functions (which already validate ownership in code) and
then **removing all client write access** to the table. The mobile client makes
**zero** direct writes to `deal_claims` (verified: no `.from('deal_claims')
.update/insert/upsert` anywhere in `app/`, `lib/`, `hooks/`, `components/`), so
this breaks nothing on the client.

**Step 1 — edge functions: use the service-role client for claim writes.**

`redeem-token/index.ts` already has `supabaseAdmin` (line ~93). Change these
writes from `supabase` to `supabaseAdmin`:
- the `finalizeStaleVisualRedeemForClaim(supabase, ...)` call (line ~410) →
  pass `supabaseAdmin`.
- the "mark expired" update (line ~457).
- the redeem `UPDATE ... .is("redeemed_at", null)` (both the new-column and
  legacy variants, lines ~480-495).
Reads may stay on `supabase` (the user-owned SELECT policy still applies).

`begin-visual-redeem/index.ts`, `complete-visual-redeem/index.ts`,
`release-claim/index.ts` currently build **only** the user client. In each, add:
```ts
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
```
and switch every `deal_claims` **write** and every
`finalizeStaleVisualRedeemForClaim(...)` call to `supabaseAdmin`:
- `begin-visual-redeem`: the finalize call (line ~68), the "expired" update
  (line ~110), the `redeeming` update (lines ~141-148).
- `complete-visual-redeem`: the finalize calls (lines ~71, ~143), the "expired"
  update (lines ~117-120), the redeem update (lines ~165-178).
- `release-claim`: the "expired" update (lines ~96-100), the "released" update
  (lines ~118-127).
Keep the existing `.eq("user_id", user.id)` / `.eq("id", claimId)` /
`.is("redeemed_at", null)` / `.eq("claim_status", ...)` filters exactly as they
are — they are what keeps the service-role writes scoped and idempotent. Keep
the initial claim SELECT + `claim.user_id !== user.id` ownership check.

**Step 2 — migration: revoke client write access.**

`supabase/migrations/<ts>_lock_down_deal_claims_client_writes.sql`:
```sql
BEGIN;

-- deal_claims is a money/trust table. All writes now go through service-role
-- edge functions (claim-deal insert, redeem-token, the SECURITY DEFINER staff
-- RPCs, begin/complete-visual-redeem, release-claim). Clients get SELECT only.
REVOKE INSERT, UPDATE, DELETE ON public.deal_claims FROM anon, authenticated;

-- Remove the out-of-band end-user UPDATE policy if it exists in prod, plus the
-- now-dead business-owner UPDATE policy (owner redeem is service-role now).
DROP POLICY IF EXISTS "Users can update their own claims" ON public.deal_claims;
DROP POLICY IF EXISTS "Businesses can update claims for their deals" ON public.deal_claims;

-- SELECT policies stay untouched:
--   "Users can read their own claims"            (auth.uid() = user_id)
--   "Businesses can read claims for their deals" (deal_claim_visible_to_business_owner)

COMMIT;
```

This is safe against the redemption paths that matter:
- The staff RPCs `preview_staff_redemption` / `confirm_staff_redemption` are
  `SECURITY DEFINER` with `row_security = off`; they run as the definer and do
  not need a table grant, so they keep working.
- `claim-deal` inserts with `supabaseAdmin` (service role) already.
- After Step 1, `redeem-token` / visual-redeem / release-claim write with
  `supabaseAdmin`.

## How to verify

1. Before the fix: as a customer JWT, PATCH your own active claim to
   `{"claim_status":"redeemed","redeemed_at":"<now>"}` — succeeds (bug). After
   the fix: the PATCH returns `401/403`/zero-rows (no grant), and the row is
   unchanged.
2. Un-redeem test: PATCH a redeemed claim to `{"claim_status":"active",
   "redeemed_at":null}` — must fail after the fix.
3. Regression — happy paths must still work end to end:
   - Customer claims a deal (`claim-deal`), then `begin-visual-redeem` →
     wait 15s → `complete-visual-redeem` returns `ok:true` and the row is
     `redeemed`.
   - `release-claim` on an active claim returns `RELEASED`.
   - Owner `redeem-token` with a valid short code marks the claim redeemed once
     and returns 409 on a second attempt (idempotent).
   - Staff `staff-redemption` `confirm` still redeems and writes a `redemptions`
     row.
4. Grep to confirm no client write path was missed:
   `grep -rn "from('deal_claims')" app lib hooks components` returns only reads.

## Do NOT

- Do **not** try to keep the client UPDATE policy and "make it safe" with an RLS
  `WITH CHECK`. RLS cannot see the OLD row, so it cannot forbid the
  `redeemed → active` un-redeem, and it cannot stop the user from setting
  `redeemed_at` on an active claim. The write must leave the client entirely.
- Do **not** switch only the redeem write and leave the "expired"/"released"
  writes on the user client — after the `REVOKE`, any remaining user-client
  write to `deal_claims` will start failing and break that flow. Move all of
  them.
- Do **not** move the ownership *reads* to service role and then drop the
  `claim.user_id !== user.id` code check. The service role bypasses RLS, so the
  in-code ownership check is now the only thing scoping a redeem/release to the
  caller — it must stay.
- Do **not** add a trigger that blocks `redeemed_at` writes from non-service
  roles as the *primary* fix while leaving the grant in place; the `REVOKE`
  is the hard stop. (A freeze trigger is fine as optional defense-in-depth, but
  make sure it exempts `service_role`, or you will break every redeem path.)

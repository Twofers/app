# Phase 0 recon notes

Read-only. Answers the questions raised in `SONNET_IMPLEMENTATION_PLAN.md` Phase 0.

## 1-2. Live `deal_claims` / `businesses` RLS policy + grant dump — BLOCKED, needs Dan

I have no prod DB access. Dan must run this against prod and paste the result back
before Phase 1b's migration is applied (Phase 1b code changes do not depend on the
answer, but confirming the migration is safe to apply does):

```sql
select policyname, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename='deal_claims';
select table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_schema='public' and table_name='deal_claims'
  and grantee in ('anon','authenticated');
```
Same two queries for `businesses`, and (for Phase 3) for `deals`, `business_locations`,
`business_profiles`, `favorites`, `consumer_profiles`, `push_tokens`.

**What the repo migrations show (not prod, but the best available signal):**
- `deal_claims`: initial schema created `"Users can insert their own claims"` (INSERT)
  and `"Businesses can update claims for their deals"` (UPDATE, owner-scoped). The
  INSERT policy was dropped in `20260630120000_lockdown_deal_claims_client_insert.sql`
  and never recreated. The UPDATE policy was redefined twice (`20260330120000`,
  `20260701130000`, latest via `deal_claim_visible_to_business_owner`) but always
  scoped to `owner_id = auth.uid()` on the *business* side — there is **no
  end-user-scoped UPDATE policy** (`auth.uid() = user_id`) anywhere in any migration.
  Since `begin-visual-redeem` / `complete-visual-redeem` / `release-claim` write via
  the user-scoped client and work in prod today, an end-user UPDATE policy must exist
  in prod out-of-band. This matches Finding 02's drift claim exactly. No migration in
  this repo ever `REVOKE`s table-level grants on `deal_claims`, so `authenticated`
  still holds the Supabase-default UPDATE/INSERT/DELETE grant regardless of policy.
- `businesses`: initial schema owner INSERT/UPDATE policies are unchanged since
  `20250127000000`. Only `20260705120000_businesses_pii_column_grants.sql` touches
  grants, and only `REVOKE SELECT` for PII columns — UPDATE/INSERT grants were never
  revoked. Matches Finding 01 exactly.

## 3. Confirm the client makes no direct writes to the money tables — DONE

```
grep -rn "from('deal_claims')" app lib hooks components
```
Result: every match in `app/` is a `.select(...)` read (wallet, dashboard, deal
detail, deal-analytics, home feed). **Zero** `.update`/`.insert`/`.upsert` calls on
`deal_claims` from the client. Confirms Finding 02's "this breaks nothing on the
client" claim.

```
grep -rn "from('businesses')" app lib hooks components
```
Result: **the client DOES write `businesses` directly** — this needs to be accounted
for in Finding 01's fix (it already is, but worth confirming explicitly):
- `app/business-setup.tsx`: `.update(bizPayload)` / `.insert({owner_id, ...bizPayload})`
  / `.update({logo_url})`. `bizPayload` fields: `name, phone, address, location,
  short_description, category, hours_text, latitude, longitude`. **None of these are
  in Finding 01's frozen column list** (`owner_id, access_level, status,
  can_publish_cached, is_demo`), so the freeze trigger does not break this flow. The
  INSERT sets `owner_id: uid` — fine, RLS `WITH CHECK (auth.uid() = owner_id)` already
  constrains this and the trigger's INSERT branch does not touch `owner_id`.
- `lib/owner-business.ts`: read-only (`.select`).
- `app/(tabs)/account/index.tsx`: writes `claim_notifications_enabled` and
  `repeat_claim_policy_type`/`repeat_claim_cooldown_days` — both explicitly called
  out in Finding 01 as intentionally left client-editable. Confirmed safe.

Conclusion: Finding 01's column-freeze trigger (freezing only `owner_id,
access_level, status, can_publish_cached, is_demo`) does not collide with any actual
client write path. Safe to implement as specified.

## 4. Stripe trial embedded in Price? — BLOCKED, needs Dan

Only Dan can answer from the Stripe Dashboard. Relevant for Phase 4 (Finding 05) — if
every checkout is an immediate paid charge with no trial, that phase is a no-op.
**Not answered yet — asked Dan; recorded here for tracking.**

## Supporting checks done for implementation safety

- `public.is_admin()` (used in Finding 01's trigger bypass) exists:
  `supabase/migrations/20260730125000_admin_dashboard_foundation.sql:226`. It is
  `LANGUAGE sql SECURITY DEFINER SET search_path = public`, returns boolean, and is
  already `GRANT EXECUTE`'d to `authenticated, service_role`. Safe to call from the
  new trigger.
- Latest migration in the repo (for timestamp ordering) is
  `20260803122000_fix_pause_recurring_deals_updated_at_bug.sql`. New migrations use
  `20260804...` per the plan.
- No migration ever `REVOKE`s table grants on `deal_claims` (checked
  `GRANT.*deal_claims|REVOKE.*deal_claims` across all migrations — zero hits), so the
  Finding 02 migration is the first one to do this.

## Still blocking Dan-only items before this phase can be marked fully verified

1. Run the two SQL dumps above against prod (deal_claims, businesses, and the Phase 3
   tables) and confirm/deny the drift-policy hypothesis.
2. Confirm whether the Stripe Price has an embedded trial (Finding 05 / Phase 4).

Proceeding with Phase 1 code changes now — neither blocker changes the Finding 01/02
code, only the confidence level of the "why does this work in prod today" narrative.

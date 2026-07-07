# Finding 04: Systemic — `authenticated` retains default write grants on every owner-owned table

Severity: High
Surface: RLS
Files:
- All migrations under `supabase/migrations/` (the grant/policy set)
- Confirmed instances: `businesses` (Finding 01), `deal_claims` (Finding 02)
- Tables to audit next: `deals`, `business_locations`, `business_profiles`,
  `favorites`, `consumer_profiles`, `push_tokens`, `deal_templates`
Status: NOT STARTED

## What is wrong

Findings 01 and 02 are two instances of one systemic problem: in Supabase,
`anon`/`authenticated` receive table-level `INSERT/UPDATE/DELETE` grants by
default, and `REVOKE ... FROM PUBLIC` does not remove them. Several tables in
this schema have a permissive "owner can update their own row" RLS policy with
**no column restriction and no `WITH CHECK`**, and no follow-up column-level
revoke. Any such table lets an authenticated owner PATCH columns that were meant
to be server-owned. This finding is the systematic sweep so the same class of
bug is not left on a table nobody checked.

The specific worry is any column that a server-side gate, price calculation,
eligibility check, or trust decision reads. Examples to look at:

- **`deals`** — "Businesses can update their own deals" (`USING` owner-check,
  no column limit). Columns like `deal_status`, `eligibility_status`,
  `is_active`, `quality_tier`, `max_claims`, `customer_value_percent` gate
  publishing and the strong-deal rules. There ARE trigger guards
  (`deals_block_suspended_location_write`, the strong-deal guard, credit-charge
  triggers), which mitigate a *direct* client publish, but confirm those
  triggers actually block a client that PATCHes `deal_status='LIVE',
  eligibility_status='VALID', is_active=true` on a weak/invalid deal. If they do
  not, a merchant can publish deals that bypass the eligibility validator.
- **`business_locations`** — "Owners can update their business locations." Check
  for any billing/suspension mirror columns on this table that a client should
  not move.
- **`business_profiles`** — the subscription columns were already protected
  (`20260726120000` line ~698 revokes column UPDATE of `stripe_*` /
  `subscription_*` / `trial_ends_at` / `current_period_ends_at`). Confirm no
  other access-bearing column remains client-writable.

## Exploit or failure path

Same shape as Findings 01/02: `PATCH /rest/v1/<table>?id=eq.<own row>` with a
server-owned column in the body. RLS passes because the row is the caller's; the
default grant permits the column write; a downstream gate reads the forged
value. The impact depends on the column — free access (01), forged redemption
(02), or unreviewed/ineligible deal publishing (`deals`).

## The fix

1. **Enumerate reality first.** Against production (read-only), dump the live
   grants and policies so you are fixing what is actually deployed, not just the
   migrations:
   ```sql
   -- column + table privileges held by anon/authenticated
   select table_name, privilege_type, grantee
   from information_schema.role_table_grants
   where table_schema='public' and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')
   order by table_name;

   -- every policy, so drift (like the deal_claims user-update policy) shows up
   select schemaname, tablename, policyname, cmd, qual, with_check
   from pg_policies where schemaname='public' order by tablename, cmd;
   ```
2. For each owner-owned table with server-meaningful columns, apply the same
   pattern as Finding 01/02, choosing per table:
   - **Column-freeze trigger** (preferred when the client legitimately edits
     *other* columns of the row — e.g. `businesses`, `deals`), or
   - **`REVOKE INSERT/UPDATE/DELETE` + route writes through service-role edge
     functions** (preferred when the client makes no direct writes — e.g.
     `deal_claims`).
3. Add a regression test/probe that fails if `anon`/`authenticated` ever regain
   `UPDATE`/`INSERT` on the protected columns, so a future migration cannot
   silently reopen it.

## How to verify

- For each protected column, attempt a direct PATCH as a normal owner JWT and
  confirm the value does not change (or the request is rejected).
- Confirm the app's legitimate edits (profile fields, deal content edits done
  via the supported edge functions/RPCs) still succeed.
- For `deals` specifically: as an owner, try to PATCH a draft/weak deal to
  `deal_status='LIVE', eligibility_status='VALID', is_active=true` and confirm
  it is blocked (by trigger or revoke) and does not become claimable via
  `claim-deal`.

## Do NOT

- Do **not** assume the migrations reflect prod. This repo has out-of-band prod
  changes (Finding 02's missing policy is one). Dump `pg_policies` and
  `role_table_grants` first.
- Do **not** blanket-`REVOKE` on a table the client *does* write directly
  without first moving those writes to an edge function — you will break the app.
  Grep `app/ lib/ hooks/ components/` for `.from('<table>')` writes before
  choosing revoke-vs-trigger.
- Do **not** treat this as done after 01/02. The point of this finding is the
  tables nobody has looked at yet.

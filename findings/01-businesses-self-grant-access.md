# Finding 01: Business owner can self-grant free "comped" access by writing `businesses.access_level`

Severity: Critical
Surface: RLS
Files:
- `supabase/migrations/20250127000000_initial_schema.sql:81-83` (permissive owner UPDATE policy)
- `supabase/migrations/20250127000000_initial_schema.sql:77-79` (permissive owner INSERT policy)
- `supabase/migrations/20260705120000_businesses_pii_column_grants.sql:13-33` (revoked SELECT only — never touched UPDATE)
- `supabase/migrations/20260730126000_website_app_onboarding_sync.sql:486-601` (`can_business_publish`, comped bypass at line 567)
- `supabase/functions/_shared/business-location-entitlement-sync.ts` (comped accounts bypass the billing gate — `COMPED_ACCESS_LEVELS`)
Status: NOT STARTED

## What is wrong

`public.businesses` has these RLS policies from the initial schema, never
tightened:

```sql
CREATE POLICY "Users can insert their own business" ON businesses
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own business" ON businesses
  FOR UPDATE USING (auth.uid() = owner_id);   -- no WITH CHECK, no column limit
```

Later migrations added billing/lifecycle columns to `businesses`:
`access_level`, `status`, `can_publish_cached`, `is_demo` (and
`repeat_claim_policy_type`, etc.). The only privilege change ever made to
`businesses` was `REVOKE SELECT` (for PII) in
`20260705120000_businesses_pii_column_grants.sql`. **UPDATE and INSERT were
never revoked**, so `authenticated` keeps Supabase's default table-level
UPDATE/INSERT grant on *all* columns, and the RLS policy above lets an owner
write any column of their own row.

`can_business_publish` (the server-side publish gate) grants full publish
access purely from `businesses.access_level` **before** it ever consults the
service-role-owned `location_entitlements`:

```
ELSIF v_business.access_level IN ('admin_comped','partner_comped','internal_test') THEN
    v_can_publish := true;   -- full limits, no entitlement required
```

And `applyBusinessBillingAccessState` treats comped accounts as untouchable —
the Stripe webhook and expiry sweeps deliberately leave their entitlements
alone. So a self-assigned comped level is free access that the billing system
will never revoke.

## Exploit or failure path

1. Attacker signs up as a business, obtains a normal `authenticated` JWT, and
   owns a `businesses` row (id = B, owner_id = them).
2. They call PostgREST directly (bypassing the app UI):
   ```
   PATCH /rest/v1/businesses?id=eq.<B>
   Authorization: Bearer <their JWT>
   apikey: <anon key>
   Content-Type: application/json
   Prefer: return=representation

   { "access_level": "admin_comped", "status": "active", "can_publish_cached": true }
   ```
   RLS `USING (auth.uid() = owner_id)` passes (they own B); no column-level
   revoke blocks the write; the update succeeds.
3. `can_business_publish(B)` now returns `canPublish: true, reason:
   'admin_comped'` with full limits, and the webhook/expiry sweeps skip them
   because comped is treated as an override.
4. Result: unlimited free use of the paid product, permanently, from one REST
   call. The same PATCH can also be done at **INSERT** time (the INSERT policy
   only checks `owner_id`), seeding `access_level='admin_comped'` on creation.

This is a direct revenue bypass and is trivially exploitable by any business
account. It is in version control (not drift), so it is reproducible today.

## The fix

Do not rely on column-level GRANTs alone here — the `businesses` column set has
grown across many migrations and an incomplete allow-list would either miss a
sensitive column or break legitimate profile edits. Use a `BEFORE INSERT OR
UPDATE` trigger that freezes the server-only columns for any non-privileged
caller. This mirrors the existing `deals_block_suspended_location_write`
trigger pattern already in the repo and is robust to future columns.

Create a new migration `supabase/migrations/<ts>_lock_businesses_server_columns.sql`:

```sql
BEGIN;

-- Columns on public.businesses that only server-owned code (Stripe webhook,
-- entitlement sync, admin RPCs/edge functions) may set. A normal business
-- owner must never be able to grant themselves access, publish state, or demo
-- status by writing their own row through PostgREST.
CREATE OR REPLACE FUNCTION public.enforce_businesses_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  -- service_role (edge functions using the service key) and real admins are
  -- the only callers allowed to move billing/lifecycle fields. Everyone else
  -- (owner sessions, redeemer sessions, anon) is frozen to safe values.
  v_privileged boolean := (COALESCE(auth.role(), '') = 'service_role') OR public.is_admin();
BEGIN
  IF v_privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Client-created rows always start with no access; the onboarding/billing
    -- server path elevates them later as service_role.
    NEW.access_level := 'none';
    NEW.status := 'pending_verification';
    NEW.can_publish_cached := false;
    NEW.is_demo := false;
    RETURN NEW;
  END IF;

  -- UPDATE: freeze protected columns to their current values regardless of
  -- what the client sent.
  NEW.owner_id           := OLD.owner_id;
  NEW.access_level       := OLD.access_level;
  NEW.status             := OLD.status;
  NEW.can_publish_cached := OLD.can_publish_cached;
  NEW.is_demo            := OLD.is_demo;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_businesses_protected_columns() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS businesses_protect_server_columns ON public.businesses;
CREATE TRIGGER businesses_protect_server_columns
  BEFORE INSERT OR UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_businesses_protected_columns();

COMMIT;
```

Notes for the implementer:

- `auth.role()` reflects the caller's request JWT role, not the trigger
  function's owner, so `service_role` edge-function writes (webhook, entitlement
  sync) pass the `v_privileged` bypass and keep working. `public.is_admin()`
  already exists (it is used in `can_business_publish` at line 516) — keep it in
  the bypass so admin RPCs/edge functions that legitimately move
  `access_level`/`status` still work.
- Confirm the exact protected-column list against the live `businesses` schema
  before applying (`\d public.businesses`). At minimum freeze `owner_id`,
  `access_level`, `status`, `can_publish_cached`, `is_demo`. If the live schema
  has other server-owned columns (e.g. `access_level_source`,
  `trial_*`, `stripe_*` mirror columns on `businesses`), add them to the freeze
  list too.
- **Business decision to confirm:** are `repeat_claim_policy_type` /
  `repeat_claim_cooldown_days` owner-editable settings (the merchant choosing
  their own repeat-visit rule) or server-owned? My recommended default: leave
  them client-editable (they are the merchant's own business rule and only
  restrict claims, never grant access). Do **not** freeze them unless Dan wants
  repeat policy changed only via an edge function.

## How to verify

1. As a normal business owner JWT (not admin, not service role), run the PATCH
   from the exploit against your own business id with
   `{"access_level":"admin_comped"}` and `return=representation`. Before the
   fix the response shows `access_level: "admin_comped"`; after the fix it shows
   the unchanged prior value.
2. Repeat with `status`, `can_publish_cached`, `is_demo`, `owner_id` — all must
   come back unchanged.
3. Call `select public.can_business_publish('<B>')` afterward — it must not
   report `reason: 'admin_comped'` for a self-modified row.
4. Regression: a service-role edge function (e.g. trigger a Stripe
   `checkout.session.completed` in test mode, or call the admin trial RPC) must
   still be able to set `access_level`/`status`. Confirm the entitlement sync
   still elevates a real paying business.
5. Regression: a normal profile edit (name, address, hours, logo) from the app
   still succeeds.

## Do NOT

- Do **not** "fix" this by only adding a `WITH CHECK` to the RLS UPDATE policy.
  RLS `WITH CHECK` sees only the *new* row and cannot express "this column must
  equal its old value," so it cannot stop an owner from setting
  `access_level='admin_comped'` — the new row still satisfies `owner_id =
  auth.uid()`. The freeze must compare OLD vs NEW, which only a trigger (or
  column-level REVOKE) can do.
- Do **not** solve it with a partial column-level `GRANT UPDATE (...)` allow-list
  unless you enumerate every current column — a missed column silently reopens
  the hole, and a column the app writes that you forgot to grant silently breaks
  profile edits.
- Do **not** gate the bypass on `auth.uid() IS NOT NULL` or on business
  ownership — the attacker *is* the authenticated owner. The only safe
  privileged callers are `service_role` and verified admins.
- Do **not** forget the INSERT branch. The INSERT policy only checks
  `owner_id`, so seeding `access_level` at creation is the same exploit without
  a second request.

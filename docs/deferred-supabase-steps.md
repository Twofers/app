# Deferred Supabase steps: business_locations keying cleanup

**Status: DO NOT RUN YET.**

**Precondition:** commit `2c69987` (branch `fix/business-locations-keying`, re-keys
`hooks/use-business-locations.ts` to `businesses.id`) must be shipped in the Android
build that pilot users actually have installed. Running these blocks before then
breaks the old app: its location reads/auto-create are keyed by `business_profiles.id`,
so Block 2's policy would reject its inserts and Block 3 would empty the location
list for the affected owners.

**Why these steps exist (2026-06-10):** prod `business_locations.business_id` held a
mix of `businesses.id` rows (5, all deals point at these) and `business_profiles.id`
rows (2 orphans, zero deals). The code fix standardizes on `businesses.id`; these SQL
steps bring the insert policy and the data in line with that. Applying any Supabase
change is hard-gated — Dan runs each block himself in the Supabase SQL editor
(supabase.com/dashboard → project → SQL Editor), one at a time, in order.

---

## Block 1 — Pre-checks (read-only; run first, stop if anything looks off)

```sql
-- 1a) The two orphan rows we plan to delete. Expect EXACTLY these two ids,
--     both with deals_pointing_here = 0:
--       b4d30281-7b86-4fb1-bc6d-78ade8ac18f9  "Cedar & Bean Cafe — main"  (demo seed)
--       7da1d527-9df2-4617-8bba-dfb5cf936683  "Coffee House — main"       (auto-create duplicate)
SELECT bl.id, bl.name, bl.address,
       (SELECT count(*) FROM public.deals d WHERE d.location_id = bl.id) AS deals_pointing_here
FROM public.business_locations bl
WHERE bl.id IN (
  'b4d30281-7b86-4fb1-bc6d-78ade8ac18f9',
  '7da1d527-9df2-4617-8bba-dfb5cf936683'
);

-- 1b) No NEW profile-keyed rows have appeared since 2026-06-10.
--     Expect: total = keyed_to_businesses + 2 (only the two orphans above).
--     If there are MORE profile-keyed rows, STOP — the old build created new
--     ones and they need the same orphan review before deleting anything.
SELECT
  count(*) AS total_location_rows,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id))          AS keyed_to_businesses,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.business_profiles bp WHERE bp.id = bl.business_id)) AS keyed_to_business_profiles
FROM public.business_locations bl;
```

## Block 2 — Rewrite the INSERT cap policy to key off `businesses`

The current policy (from migration `20260630123000`) checks `business_profiles`,
which would block the fixed app's auto-create for new businesses. This version
enforces the same cap (pro = 1 location, premium = 3 — the locked pilot decision)
keyed off `businesses.owner_id` and `businesses.subscription_tier` (column added
to prod 2026-06-10).

```sql
BEGIN;

DROP POLICY IF EXISTS "Owners can insert their business locations" ON public.business_locations;

CREATE POLICY "Owners can insert their business locations"
  ON public.business_locations FOR INSERT
  WITH CHECK (
    -- Ownership: only the business owner may add locations to it.
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id
        AND b.owner_id = auth.uid()
    )
    AND
    -- Cap: existing locations for this business (excluding the row being
    -- inserted) must stay strictly below the tier's maximum.
    (
      SELECT count(*)
      FROM public.business_locations bl
      WHERE bl.business_id = business_locations.business_id
        AND bl.id <> business_locations.id
    ) <
    (
      SELECT CASE WHEN b.subscription_tier = 'premium' THEN 3 ELSE 1 END
      FROM public.businesses b
      WHERE b.id = business_locations.business_id
        AND b.owner_id = auth.uid()
    )
  );

COMMIT;
```

## Block 3 — Delete the two orphan location rows

Deletes only the two known orphans, and only if still no deal points at them
(the `NOT EXISTS` guard makes this a no-op for any row a deal has since adopted).

```sql
BEGIN;

DELETE FROM public.business_locations bl
WHERE bl.id IN (
  'b4d30281-7b86-4fb1-bc6d-78ade8ac18f9',  -- "Cedar & Bean Cafe — main" (demo seed)
  '7da1d527-9df2-4617-8bba-dfb5cf936683'   -- "Coffee House — main" (auto-create duplicate)
)
AND NOT EXISTS (
  SELECT 1 FROM public.deals d WHERE d.location_id = bl.id
);

COMMIT;
```

## Block 4 — Verify

```sql
-- 4a) Orphans gone: expect zero rows.
SELECT id, name FROM public.business_locations
WHERE id IN (
  'b4d30281-7b86-4fb1-bc6d-78ade8ac18f9',
  '7da1d527-9df2-4617-8bba-dfb5cf936683'
);

-- 4b) Every remaining location row is keyed to businesses, and no deal lost
--     its location. Expect: profile_keyed_rows = 0, deals_missing_location = 0,
--     and 5 policies on business_locations.
SELECT
  (SELECT count(*) FROM public.business_locations bl
    WHERE NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id)) AS profile_keyed_rows,
  (SELECT count(*) FROM public.deals WHERE location_id IS NULL)                        AS deals_missing_location,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'business_locations')                  AS policy_count;
```

---

After all four blocks pass: delete this file (the work is done) and, in the app,
confirm the business location screen loads and a deal can be created end-to-end.
If any block errors, stop and bring the exact error message back to the agent —
each block is transactional, so a failure leaves nothing half-applied.

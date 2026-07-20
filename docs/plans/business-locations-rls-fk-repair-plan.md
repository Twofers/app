# Plan: repair business_locations owner RLS policies + missing foreign key

**Status: COMPLETE — APPLIED TO PRODUCTION 2026-07-19 and verified. See §0.**
**Written 2026-07-19. Executor: Claude Opus session. Investigation record: memory `location-cap-rls-investigation-2026-07-19` (session of 2026-07-19).**

---

## 0. Execution record (2026-07-19)

**Done (no gates crossed):**

| Step | Outcome |
|---|---|
| §3 Step 0 — identify testing key | **Key is a PROD service-level key.** Test project → 401/401; prod → 200/200. Used read-only only; no prod writes. |
| §4.1 Prod policy inventory | **DONE 2026-07-19** (Dan ran it in the SQL editor). Result overturned a core premise — see "Prod policy inventory" below. No unexpected policy; DROP list is complete. |
| §4.2 Orphan inventory | **Done — see deviations below.** |
| §4.3 Tier source check | **Done — see deviations below.** |
| §1.4 FK re-verify | **Confirmed still absent.** PGRST200 for both `businesses` and `business_profiles` embeds. |
| §5 Migration | Authored: `supabase/migrations/20260819120000_fix_business_locations_owner_rls_and_fk.sql` |
| §6 Test script | Authored: `scripts/db-tests/2g-business-locations-rls.mjs`, wired into `scripts/db-tests/run.mjs` |
| §6 Baseline checks | `npm run typecheck` clean, `npm run lint` clean, `npm test` 1694/1694 passed |
| §7.4 Supersede deferred doc | Done — `docs/deferred-supabase-steps.md` replaced with a pointer here |
| §6.1 PRE-apply baseline (test) | **Done.** 6 passed / 3 failed / 2 skipped — INSERT denied 42501, and the FK was found pointing at `business_profiles`, proving the target-aware guard was necessary. |
| §6.2 Apply to TEST project | **Done 2026-07-19**, by hand in the test project's SQL editor. Deliberately NOT `db push`: the test project is ~22 migrations behind, and a push would have carried them all, including a demo-data seed and another workstream's migration. Took two passes — the first exposed the grant trap. |
| §6.3 POST-apply matrix (test) | **17 passed, 0 failed, 1 skipped** (anon SELECT, recorded not asserted). Cap boundaries at 1 and 3, cross-tenant INSERT/UPDATE/DELETE denied, UPDATE WITH CHECK blocks re-pointing, FK 23503 cites `businesses`, business deletion cascades. |
| §7.3 **APPLY TO PRODUCTION** | **Done 2026-07-19**, by hand in the prod SQL editor. |
| §6 Prod verification | **All green.** `probe-rls-smoke.mjs` 7/7 · FK embed `business_locations→businesses` returns **200** (and `→business_profiles` correctly 400 PGRST200) · `business_locations` 9→**3** rows, orphans 6→**0**, both known June orphans gone · `location_entitlements` 3 rows with **0 dangling** · 57 deals, **0** pointing at a missing location (the 44 NULL `location_id` rows are pre-existing — pre-apply checks confirmed 0 deals referenced any orphan, so nothing was nulled by this) · helper fns `user_owns_business`, `location_cap_for_current_user`, `business_location_count` all resolve on prod. |

**Caveat — no ledger row.** Both applies were done by hand in the SQL editor, so
neither project has a `20260819120000` row in
`supabase_migrations.schema_migrations`. The file is fully idempotent (guarded
FK, `DROP POLICY IF EXISTS`, `DELETE ... WHERE NOT EXISTS`), so a later
`db push` re-running it is harmless — but until then the ledger understates
reality in both environments.

**Still open:** device smoke of the deal-wizard location step — the user-visible
path that has been silently broken, and the one thing the probes cannot confirm.

### Prod policy inventory (§4.1 result, 2026-07-19) — overturns §1

Prod has **drifted from the migration files**, mostly in the helpful direction.
Live state:

| Policy | Prod | Verdict |
|---|---|---|
| `Owners can read their business locations` (SELECT) | joins `businesses.owner_id`, role `public` | already correct |
| `Owners can update their business locations` (UPDATE) | joins `businesses.owner_id`, **`with_check` IS NULL** | correct join, **cross-tenant write hole** |
| `Owners can delete their business locations` (DELETE) | joins `businesses.owner_id`, role `public` | already correct |
| `Owners can insert their business locations` (INSERT) | dead `business_profiles` join (20260807130000) | **broken** |
| `Auth users can read business locations (pilot)` | `TO public USING (auth.uid() IS NOT NULL)` | present; not `USING (true)` as §5a assumed |
| `redeemer_business_locations_block_all` | RESTRICTIVE FOR ALL | as expected, untouched |

FK query returned **zero rows** — the missing FK is re-confirmed.

**Consequences for this plan:**

- **§1's claim that all four owner policies are dead-joined is wrong for prod.**
  Only INSERT is. Owners *can* read, update, and delete locations today. What
  still holds: the deal-wizard auto-create (an INSERT) is denied every time, and
  the location cap is enforced by nothing.
- **The migration files are the drifted artifact, not prod.** `20260601153000`
  still declares all four verbs against `business_profiles`, so any environment
  built from migrations alone gets four broken policies *and* no shopper read
  path. Codifying prod's shape is now the primary value of §5b.
- **Prod's UPDATE has no `WITH CHECK`** — an owner can re-point their location at
  another business's id. The migration closes this; it is a genuine hardening,
  not a no-op. Test 2g's re-point check covers it.
- **§5a was corrected to mirror prod verbatim** (`TO public USING (auth.uid() IS
  NOT NULL)`) rather than the assumed `TO authenticated USING (true)`.
- No unexpected policy appeared, so the migration's `DROP POLICY IF EXISTS` list
  is complete — the §4.1 stop condition did not fire.

**Net effect against prod** is therefore narrower than the plan implied: repair
INSERT (and with it the cap), add the missing UPDATE `WITH CHECK`, delete 6
orphan rows, add the FK. The SELECT/UPDATE/DELETE rewrites are no-ops that put
prod's hand-made June repairs under version control.

### Test-project state (probed read-only 2026-07-19)

Schema probing puts the test project at **~20260807130000** — `business_location_count`
and `is_redeemer_session` exist; `admin_user_id_by_email`, `hidden_businesses`,
`wallet_passes`, `qr_campaigns`, `business_name_change_requests` do not. So a
`supabase db push` would carry **22 migrations (~4,300 lines)**, only one of which
is this plan's. Flagged riders: `20260815133000_restore_cedar_bean_demo_deals`
(367-line DATA seed), `20260817120000_approved_not_activated_activation_gate`
(1,782 lines), and `20260819130000_promo_materials_authorizations` (a different
workstream's unapplied migration that would ride along).

**`business_profiles.business_id` is prod-only drift.** It exists in prod but is
created by NO migration and read by NO code, and it is absent on the test
project. The cap subquery in §5b originally referenced it, which would have made
the INSERT policy fail to create on every migration-built environment. Corrected
to locate the profile via `user_id` / `owner_id` only. `2g` and `2c` were
corrected to stop seeding the column too.

### The grant trap (found by the first test-project apply, 2026-07-19)

Applying to the test project fixed the FK (23503 now cites `businesses`, cascade
verified) but every owner policy failed with:

```
42501: permission denied for table businesses
hint: GRANT SELECT ON public.businesses TO authenticated;
```

**RLS policy expressions execute with the privileges of the querying role**, and
`20260705120000` deliberately revoked SELECT on `businesses` from
anon/authenticated. A policy that reads the table directly dies at the GRANT
layer before RLS is consulted. Restoring the grant would undo an intentional
hardening, so it is not an option.

Fix: ownership and cap lookups moved into SECURITY DEFINER helpers —
`public.user_owns_business(uuid)` and `public.location_cap_for_current_user()` —
matching the pattern `business_location_count` already set for the same reason.
Both are `REVOKE ALL FROM public` + `GRANT EXECUTE TO authenticated`, and
`user_owns_business` discloses nothing (a caller learns only whether *they* own
the id they passed).

**Implication for prod — RESOLVED 2026-07-19, the hypothesis was WRONG.** I
claimed prod's hand-repaired policies were "very likely non-functional" there
too. The grant query disproved it: prod holds a **table-level** SELECT on
`businesses` for `authenticated`, so those policies execute fine. Retracted.

The reason they work is itself a defect. `20260705120000` implements
*column-level* grants — revoke table-wide SELECT, re-grant a safe column list
that deliberately excludes `owner_id`, `business_email`, `contact_name`, `tone`,
with owners expected to use the `get_my_business()` definer function. The test
project matches that intent (hence its 42501). Prod does not; something later
restored a full table-level SELECT.

Proof the distinction is real rather than an artifact of the view:
`information_schema.role_table_grants` lists table-level grants only. `anon` is
absent from it yet can still read `businesses.name` (verified read-only) while
being denied `owner_id` / `business_email` — so column-only grants do not appear
there. `authenticated` *does* appear with SELECT, so its grant is genuinely
table-wide, covering every PII column. Net effect: any logged-in user can read
every business's `owner_id`, `business_email`, `contact_name`, `tone`.

Tracked as separate follow-up work, out of scope here. The SECURITY DEFINER
helpers remain the right design regardless — they work under both grant models,
so these policies do not silently depend on the prod regression, and they will
keep working once it is repaired (direct-reading policies would not).

### Deviations the live data forced

1. **Six orphans, not two — and all six are referenced.** Prod holds 9 location
   rows against 3 businesses. Six are orphaned, and *every one* carries a
   `location_entitlements` row, so §5c's guard as originally written would have
   RAISEd and aborted the migration outright. Inspection shows all six
   entitlements are **inert placeholders** from a single 2026-06-22 backfill:
   `status='trial_eligible'`, no billing account, no provider subscription, no
   trial started, never paid. The implemented guard therefore aborts only on a
   *non-inert* entitlement (or any deal / credit period), which preserves the
   fail-safe while letting the known-dead rows be reaped.
2. **The FK guard must be target-aware.** §5d checked only for a constraint
   *name*. Prod has no FK, but a migration-built environment (the test project)
   may carry `20260601153000`'s FK pointing at `business_profiles` under exactly
   that name — a name-only check would silently leave the wrong target in place.
   The implemented version inspects `confrelid` and drops a mismatch first.
3. **The app keys tier off neither table.** `hooks/use-business.ts:130` hardcodes
   `subscription_tier: "pro"` (location-level entitlements are the real source
   of truth) and `maxLocationsForTier` returns 1 while paid billing is off. So
   the client never attempts a second location under the pilot lock regardless.
   The migration keeps `business_profiles.subscription_tier` (canonical per
   billing v4) for the premium=3 server path and documents this in-file — it is
   a superset of client behavior, not a conflict.

### Two further notes

- **§8 risk 1 does not fire.** Only 1 of the 6 orphans has the old-build
  `business_profiles.id` signature, and it is one of the two known June orphans.
  No *new* profile-keyed rows — no evidence a pre-re-key build is still writing.
  Re-check this immediately before applying.
- **`2c-rls-cross-tenant.mjs` needed a correction.** It asserted
  `business_locations` is cross-tenant-unreadable. That is true only on the test
  project, which lacks the pilot read policy; in prod locations are readable by
  any authenticated user by design (shoppers need them to render deals).
  Codifying that policy would have broken 2c, so the table was moved from its
  "private" list to its "public catalog" list with the reasoning recorded inline.

---

## 1. Problem (confirmed, not hypothetical)

`business_locations.business_id` holds **`businesses.id`** values. That is the
deliberate, current keying: the app writes it that way
(`hooks/use-business-locations.ts:40`) and the activation-gate RPC inserts it
that way server-side (`20260817120000_approved_not_activated_activation_gate.sql:855`).

> **Correction (2026-07-19, after the §4.1 inventory ran):** the claim below is
> true of the *migration files*, but NOT of live prod. Prod's SELECT / UPDATE /
> DELETE were hand-repaired to `businesses.owner_id` in June; only INSERT is
> still dead-joined. Read §0 for the verified state — the rest of this section
> is the pre-inventory hypothesis, kept for the reasoning trail.

But the four owner RLS policies on `business_locations` all join
**`business_profiles.id = business_locations.business_id`**:

- INSERT + cap: `20260807130000_fix_business_locations_recursion.sql` (superseded `20260630123000`; both wrong)
- SELECT / UPDATE / DELETE: `20260601153000_billing_v4_app_config_and_subscription_rls.sql:128-177`

`business_profiles.id` is an independent `gen_random_uuid()` PK — **no code
path ever sets it equal to `businesses.id`** (verified across all inserters,
incl. `supabase/functions/_shared/business-onboarding-sync.ts`). The join is
always false. Consequences in prod today:

1. Owners can never INSERT / UPDATE / DELETE location rows from the client.
   The deal-wizard auto-create (`app/create/menu-offer.tsx` via the hook) is
   RLS-denied every time; it only goes unnoticed because the activation gate
   creates the primary location server-side (SECURITY DEFINER, bypasses RLS).
2. The pro=1 / premium=3 location cap is enforced by *nothing that works*
   (client inserts denied wholesale; server path bypasses RLS).
3. Reads survive only via the hand-created prod-only policy
   `"Auth users can read business locations (pilot)"` (created by Dan in the
   SQL editor 2026-06-10; **not in any migration file**, so migration-built
   environments — e.g. the test project — have no working read path).
4. **Prod has NO foreign key on `business_locations.business_id` at all** —
   verified read-only 2026-07-19 via PostgREST embedded-select probe (PGRST200
   "no relationship found" for BOTH `businesses` and `business_profiles`).
   billing_v4 dropped the original FK→businesses and its replacement
   ADD CONSTRAINT→business_profiles never took effect (drift-repair era).
   No referential integrity, no ON DELETE CASCADE from business deletion.
5. `docs/deferred-supabase-steps.md` (June 2026: correct policy rewrite + 2
   orphan-row deletes) was never run — and would have been clobbered by
   `20260807130000` anyway. That doc is **superseded by this plan** (step 7).

`supabase migration list --linked` shows local == remote for every migration,
so the wrong-table policy versions are what prod is running. Migration-table
state cannot be trusted for the FK (drift repair), which is why the FK finding
rests on the live PostgREST probe instead.

## 2. Testing key (from Dan, 2026-07-19)

A Supabase secret key for testing is stored in **`.env.test.local`** at the
repo root (gitignored), variable `SUPABASE_SECRET_KEY_TESTING`. Rules:

- **Never** print it, commit it, paste it into chat/docs/PRs, or move it out
  of gitignored files. Scripts must read it from the file.
- **Which project it belongs to is UNVERIFIED.** The prior session was
  permission-blocked from probing. **Step 0 must resolve this before any use.**
- If it turns out to be a **prod** key, use it for READ-ONLY inventory only
  (section 4); never for prod writes. All prod mutation goes through Dan.

## 3. Step 0 — identify the key's project (read-only)

Run a status-code-only probe (no row data, no key echo): for each of
`https://zsuzrerdailvylccqtds.supabase.co` (approved test ref, see
`scripts/assert-test-db.mjs`) and the prod URL from `.env`, send
`GET {url}/rest/v1/business_locations?select=id&limit=1` and
`GET {url}/auth/v1/admin/users?per_page=1` with the key as both `apikey` and
`Bearer`. 200 on the admin endpoint = service-level key for that project;
401/403 = wrong project. Print **status codes only**.

- Key is TEST-project → full behavioral testing available (section 6).
- Key is PROD → read-only inventory only (section 4); behavioral tests on the
  test project use the existing `.env.test` `SUPABASE_SERVICE_ROLE_KEY`.
- Key works nowhere → tell Dan; proceed with plan minus the steps needing it.

If permission prompts block running the probe, ask Dan to approve — do not
work around a denial.

## 4. Pre-flight verification (read-only; before writing the migration)

1. **Prod policy inventory** — the one gap the prior investigation could not
   close without SQL access. Either via the prod-capable key (REST cannot read
   `pg_policies`; so this needs Dan) or ask Dan to run in the SQL editor:
   ```sql
   SELECT policyname, cmd, permissive, roles, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'business_locations'
   ORDER BY cmd, policyname;
   ```
   Expected: 4 owner policies dead-joining `business_profiles`, the pilot read
   policy, and the redeemer RESTRICTIVE block(s) from `20260712120000`. If
   anything else appears (e.g. a leftover permissive INSERT bypass), STOP and
   report before authoring — the migration must account for it.
2. **Orphan inventory** (prod): count rows whose `business_id` has no match in
   `businesses`; separately check the two known June orphans
   (`b4d30281-7b86-4fb1-bc6d-78ade8ac18f9`, `7da1d527-9df2-4617-8bba-dfb5cf936683`)
   and whether any deal/entitlement/credit row points at any orphan. With a
   prod-capable key this is doable over REST (fetch `business_locations`
   id+business_id and `businesses` id lists; compare locally; small tables).
   Otherwise reuse Block 1 of `docs/deferred-supabase-steps.md` via Dan.
   **Do not put business names/addresses in chat output.**
3. **Tier source check**: confirm which column the app's cap actually uses —
   `useBusiness()`'s `subscriptionTier` — and note that billing v4 makes
   `business_profiles.subscription_tier` canonical while
   `businesses.subscription_tier` also exists (`20260530120000:18`). The
   migration below uses `business_profiles` via owner join; if the app turns
   out to key tier off `businesses`, keep the SQL consistent with the app and
   say so in the migration comment. Under the pilot lock (1 location per
   business) both resolve to cap=1 today, so this is about correctness of the
   premium=3 path, not current behavior.

## 5. The migration (single new file)

`supabase/migrations/<next-timestamp>_fix_business_locations_owner_rls_and_fk.sql`
— next timestamp after `20260818120000` per the existing daily convention.
All statements idempotent (DROP POLICY IF EXISTS / DO-block guards); Supabase
wraps the file in one transaction.

### 5a. Codify the shopper read policy (prod no-op, fixes migration-built envs)
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'business_locations'
      AND policyname = 'Auth users can read business locations (pilot)'
  ) THEN
    CREATE POLICY "Auth users can read business locations (pilot)"
      ON public.business_locations FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
```
(Shoppers must read locations to render deals — this is the load-bearing read
path Dan kept on 2026-06-10. Verify the exact prod policy definition in step
4.1 and mirror it; if prod's version differs, mirror prod.)

### 5b. Rewrite the four owner policies keyed off `businesses`
Ownership = `businesses.owner_id = auth.uid()` (hard role split; owner is
`businesses.owner_id` per the promo-materials plan's roles audit). Keep the
existing `public.business_location_count(uuid)` SECURITY DEFINER helper from
`20260807130000` — it exists precisely to avoid counting-under-RLS recursion.

```sql
DROP POLICY IF EXISTS "Owners can insert their business locations" ON public.business_locations;
CREATE POLICY "Owners can insert their business locations"
  ON public.business_locations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id
        AND b.owner_id = auth.uid()
    )
    AND public.business_location_count(business_locations.business_id) < COALESCE(
      (SELECT CASE WHEN bp.subscription_tier = 'premium' THEN 3 ELSE 1 END
       FROM public.business_profiles bp
       WHERE bp.user_id = auth.uid() OR bp.owner_id = auth.uid()
       LIMIT 1),
      1  -- no billing profile yet => pilot default cap of 1
    )
  );
```
SELECT (owner variant), UPDATE (USING + WITH CHECK), DELETE: same
`EXISTS (... businesses b ... b.owner_id = auth.uid())` shape, replacing the
same-named policies from `20260601153000`. Notes:
- These are PERMISSIVE policies, so plain boolean logic is fine; the
  COALESCE-to-false rule from the RLS-NULL incident applies to RESTRICTIVE
  policies — but the cap subquery above still COALESCEs so a missing
  billing profile yields cap 1, not NULL (NULL would deny all inserts).
- **Do not touch** the redeemer RESTRICTIVE `redeemer_*_block_all` policies
  (`20260712120000`) or anything else on the table.
- Note the cap check counts existing rows only (`business_location_count`),
  matching 20260807 semantics; no `bl.id <> NEW.id` clause is needed since the
  row being inserted isn't visible to the helper's SELECT until committed.

### 5c. Orphan cleanup (generalized; guarded)
```sql
-- Remove location rows whose business_id matches no businesses row AND that
-- nothing points at. Refuse to proceed if a referenced orphan exists.
DO $$
DECLARE v_blocked int;
BEGIN
  SELECT count(*) INTO v_blocked
  FROM public.business_locations bl
  WHERE NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id)
    AND (
      EXISTS (SELECT 1 FROM public.deals d WHERE d.location_id = bl.id)
      OR EXISTS (SELECT 1 FROM public.location_entitlements le WHERE le.business_location_id = bl.id)
      OR EXISTS (SELECT 1 FROM public.deal_credit_periods p WHERE p.business_location_id = bl.id)
    );
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'business_locations FK repair: % orphan row(s) still referenced — manual review required', v_blocked;
  END IF;

  DELETE FROM public.business_locations bl
  WHERE NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id);
END $$;
```
(As of 2026-06-10 the only orphans were the two known zero-deal rows; step 4.2
re-verifies before apply. The RAISE aborts the whole migration transaction if
that has changed — safe failure.)

### 5d. Restore the foreign key
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'business_locations_business_id_fkey'
      AND conrelid = 'public.business_locations'::regclass
  ) THEN
    ALTER TABLE public.business_locations
      ADD CONSTRAINT business_locations_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES public.businesses(id)
      ON DELETE CASCADE;
  END IF;
END $$;
```
CASCADE is correct: deleting a business then cascades to its locations, whose
own dependents are already declared sanely — historical pointers
(`deals.location_id`, `deal_claims`, `redemptions`, `redemption_devices`,
offer-version tables) are `ON DELETE SET NULL`; billing rows
(`location_entitlements`, `deal_credit_*`, `billing_*`,
`business_location_identity`, duplicate-review queue) are `ON DELETE CASCADE`.
This restores the pre-billing_v4 delete chain that account purge expects.

### 5e. What this migration must NOT do
- No changes to app code (the hook already writes `businesses.id`; nothing
  client-side needs to change).
- No changes to redeemer policies, deals policies, or the entitlement helper
  functions (`_shared/business-location-entitlement-sync` dual-join helpers
  keep working — their `businesses` branch simply becomes the live one).
- No edits to any AI-poster-locked file (none are involved).

## 6. Validation

Baseline: `npm run typecheck`, `npm run lint`, `npm test` (should be
no-change-green; no app code touched).

**Behavioral DB tests** — new script `scripts/db-tests/business-locations-rls.mjs`
following the existing `_shared.mjs` conventions (`assertTestDb()` first
statement; throwaway users via admin API; full cleanup in `finally`):

1. PRE-apply on the test project: owner INSERT keyed by `businesses.id` is
   **denied** (bug reproduced — also proves the test detects the broken state).
2. Apply the migration to the **test project** (⚠️ gated: "applying Supabase
   migrations" is a hard gate regardless of project — get Dan's OK; note the
   test project may also have older pending migrations, list them first and
   tell Dan what a push will carry along).
3. POST-apply matrix:
   - owner INSERT (1st location) → allowed
   - owner INSERT (2nd location, pro tier) → denied (cap)
   - premium-tier owner 2nd/3rd insert → allowed; 4th → denied (only if a
     premium fixture is feasible; otherwise assert the SQL branch via tier
     update as service role)
   - non-owner authenticated INSERT → denied
   - owner UPDATE / DELETE own row → allowed; other's row → denied
   - authenticated shopper SELECT → allowed (pilot read policy)
   - INSERT with a `business_id` matching no business → FK violation (23503)
   - anon SELECT → whatever prod parity requires (record, don't assert-fail)

**Prod, after Dan applies (section 7):**
- `node scripts/probe-rls-smoke.mjs` — mandatory after any RLS migration.
- Re-run the PostgREST FK embed probe: `business_locations?select=id,businesses(id)`
  must now return 200 (relationship visible ⇒ FK live; also confirms schema
  cache reloaded).
- App smoke on device/emulator when convenient: business account → create-deal
  wizard → location step loads; a business with no location row gets one
  auto-created (this is the path that has been silently broken).

## 7. Rollout order + cleanup

1. Author migration + test script on the current branch. Run baseline checks.
2. Dan approves → apply to test project → run behavioral matrix.
3. Dan approves → `supabase db push` to prod (from the repo root, per the
   worktree-deploy rule if working from a worktree) → run the prod checks above.
4. Mark `docs/deferred-supabase-steps.md` superseded by this plan (replace its
   body with a pointer, or delete it — its blocks are now subsumed here).
5. Update memory (`location-cap-rls-investigation-2026-07-19`) with the outcome.
6. Commit locally only when Dan asks. Never push.

## 8. Risks

- **Old installed builds**: any pilot build predating the June hook re-key
  wrote `business_profiles.id` into `business_id`; after this migration those
  writes fail the FK (23503) instead of being silently mis-keyed. That is
  desired — but if step 4.2 finds *new* profile-keyed rows (sign such a build
  is still in use), stop and report before applying.
- **Unknown prod policy drift**: prod policies were hand-edited in June; step
  4.1 exists precisely to catch a surprise policy before we assume the set.
- **Cap semantics change**: today no client insert succeeds, so *any* fix
  changes observable behavior (owners will be able to add a location up to
  cap, where the server previously did it for them). This matches the locked
  product decision (pilot cap 1; premium 3) — it is a repair, not a feature.
- **Migration aborts on referenced orphans** (5c RAISE): intentional fail-safe;
  if it fires, the whole transaction rolls back and nothing is half-applied.

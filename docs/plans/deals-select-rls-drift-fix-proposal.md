# Proposal: reconcile the `deals` RLS drift (migrations vs prod)

Status: **PROPOSAL — do not apply as-is.** Applying Supabase migrations is
hard-gated and this is RLS-sensitive. This doc lives in `docs/plans/` (not
`supabase/migrations/`) on purpose. Updated 2026-07-11 with a **read-only prod
`pg_policies` probe** (Dan-authorized) that replaced the earlier file-only
guesswork — prod's live policy set is very different from the migration files.

## What prod actually has (probe, 2026-07-11, project `kvodhiqhdqnptqovovia`)

`SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename='deals'`
returned ~14 policies — far more than the migration files define. Grouped:

**Public read (no `owner_id`) — three overlapping SELECT policies:**
| policy | `USING` | note |
|---|---|---|
| `Anyone can read active deals` | `is_active AND end_time>now() AND start_time<=now()` | correct — hides not-yet-started deals |
| `public view active deals` | `is_active AND start_time<=now() AND end_time>now()` | correct — duplicate of the above |
| `deals_public_read_live` | `is_active AND now()<end_time` | **BUG: no `start_time` gate** |

**Owner read (references `businesses.owner_id`, role `{public}`):**
`Businesses can read their own deals` — `EXISTS(SELECT 1 FROM businesses WHERE
id=deals.business_id AND owner_id=auth.uid())`. This is the **pre-billing-v4
shape** — no `business_profiles` subscription gate, unlike migration
`20260601153000`. So billing-v4's intended replacement never took on prod (or was
overlaid by later manual policies).

**Claim / redeemer:** `Users can read deals they claimed`,
`redeemer_deals_select_guard`.

**Owner CRUD (overlapping):** `deals_owner_crud` (ALL), `business manage own
deals` (ALL), `Businesses can insert/update/delete their own deals`,
`redeemer_deals_{insert,update,delete}_guard`.

PII column grants **are** applied on prod: an anon `select=owner_id` /
`business_email` / `contact_name` on `businesses` returns `42501 permission
denied`, while `select=id` returns 200. So `owner_id` is genuinely ungranted to
clients — the PII migration `20260705120000` is live.

## Findings

### F1 — over-exposure: scheduled deals leak before they start (real)
`deals_public_read_live` grants public SELECT on any `is_active` deal whose
`end_time` is in the future, with **no `start_time <= now()` check**. Because
permissive RLS policies OR together, this is the most permissive branch and it
**defeats the explicit "hide deals that have not started yet" intent** documented
in migration `20260330140000`. A one-time deal scheduled for the future (active,
not yet started) is publicly readable early. Confidence: high (it's literally in
the live policy list). This is the one finding with user-visible impact.

### F2 — policy sprawl / drift (maintainability + fragility)
Three near-identical public-read policies and 4+ overlapping owner-CRUD policies
have accumulated across migrations and manual edits, in three different naming
styles (`Title Case`, `snake_case`, `lower case`). Old policies were never
dropped when new ones were added. Hard to reason about; easy to reintroduce a
leak like F1.

### F3 — the blanket 403 is a plan-time `businesses` privilege failure (CONFIRMED)
The owner-read policy's subquery reads `businesses` (`owner_id`), which clients
can't SELECT after the PII grants. **Reproduced on the test project
`zsuzrerdailvylccqtds` 2026-07-11** with `scripts/probe-deals-rls.mjs` (throwaway
authenticated user): *every* authenticated `deals` SELECT — including a plain
`select=id&limit=1` and a live-only `is_active=eq.true` read — returns:

```
42501  permission denied for table businesses
hint:  Grant the required privileges to the current role with:
       GRANT SELECT ON public.businesses TO authenticated;
```

Service-role reads return 200 (RLS bypassed). So this is a **plan-time**
privilege check, not a per-row short-circuit (my earlier theory was wrong — even
a live-deal read fails, because Postgres validates the `businesses` privilege for
the owner policy regardless of which rows/policies would match). The moment any
policy on `deals` references `businesses`, the querying role must be able to read
`businesses` or the whole statement 42501s.

**Why prod still works:** prod's authenticated `deals` reads succeed, so on prod
the `authenticated` role *can* read `businesses` — unlike the test project. The
grant state itself is drifted between the two. **Follow-up (unverified — QA
shopper creds were stale):** confirm whether prod `authenticated` can read
`businesses.owner_id` / `business_email`; if so, the PII migration's intent
(hide those from clients) is only half in force on prod and authenticated users
can read owner PII — a separate finding.

**Why the fix works:** routing the owner check through a `SECURITY DEFINER`
helper means the *policy* reads `businesses` with definer privileges, so the
querying role no longer needs any `businesses` grant — which is exactly what the
42501 hint asks for. The consolidation is therefore well-founded; it still must
be applied to the test project and re-probed to capture the green "after".

## Proposed fix (consolidation migration — gated, validate on test first)

Not the earlier single-policy swap. Consolidate to remove F1 and F3:

1. **Collapse the three public-read policies into one correct definition** (keep
   the `start_time <= now()` gate); drop `deals_public_read_live` and one of the
   duplicates.
   ```sql
   DROP POLICY IF EXISTS "deals_public_read_live"     ON public.deals;
   DROP POLICY IF EXISTS "public view active deals"   ON public.deals;
   DROP POLICY IF EXISTS "Anyone can read active deals" ON public.deals;
   CREATE POLICY "deals_public_read_active" ON public.deals FOR SELECT
     USING (is_active = true AND start_time <= now() AND end_time > now());
   ```
2. **Refactor `owner_id` references behind a SECURITY DEFINER helper** so the
   caller context never reads the ungranted column (removes F3). Mirrors the
   existing `get_my_business()` pattern; do **not** re-grant `owner_id`.
   ```sql
   CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
   RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
   AS $$ SELECT EXISTS (SELECT 1 FROM public.businesses b
                        WHERE b.id = p_business_id AND b.owner_id = auth.uid()); $$;
   REVOKE EXECUTE ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon;
   GRANT  EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated;
   -- then rewrite the owner read/CRUD policies to call is_business_owner(business_id)
   -- instead of EXISTS(... businesses ... owner_id = auth.uid()).
   ```
3. **De-duplicate the owner-CRUD policies** into one coherent set, deciding
   whether the billing-v4 subscription gate (`trial`/`active`) should apply to
   owner *reads* (prod currently does NOT gate reads — confirm intended).

## Status of the pieces

- **F1 drop** — ready as `supabase/migrations/20260812120000_drop_deals_public_read_live.sql`
  (+ `drop-deals-public-read-live-migration.test.ts`). Low-risk, standalone.
  Not yet applied (gated).
- **Before-state reproduced** — `scripts/probe-deals-rls.mjs`
  (`npm run probe:deals-rls`) confirms the test project's authenticated `deals`
  read 42501s today (F3). Re-run it after applying the consolidation to prove the
  fix.
- **Consolidation** — written as
  `supabase/migrations/20260812130000_consolidate_deals_rls_policies.sql`
  (+ `consolidate-deals-rls-migration.test.ts`, 6 checks). Reconstructed from the
  source migrations (billing-v4 owner policies, 20260730120000 delete-ended,
  20260712120000 redeemer guards) so it is idempotent and converges BOTH test and
  prod. **NOT yet applied/validated** — applying DDL from this machine is blocked
  (no test DB password; `supabase db push` needs one; `psql`/`pg`/Docker
  unavailable). Push it to the test project, then run the three checks below.

  **Two behavior decisions baked as "preserve current prod behavior" (ungated),
  with the stricter migration-intent variants left as commented `-- (a)/(b)`
  blocks in the file:** prod's manual `deals_owner_crud` / `business manage own
  deals` (ALL) policies had removed (a) the billing-v4 trial/active subscription
  gate on owner select/insert/update and (b) the ended-only delete restriction.
  Uncomment to restore either; leaving them commented keeps today's behavior.

## Required steps before applying (all Dan-gated)

1. Apply the consolidation to the **test project** (`zsuzrerdailvylccqtds`) —
   e.g. `supabase db push --db-url <test-conn>` or the dashboard SQL editor.
2. Re-run `node scripts/probe-deals-rls.mjs` (now green), `node
   scripts/probe-rls-smoke.mjs`, and `npm run test:db` (suite 2c).
3. Decide whether prod's extra manual policies + the `businesses` authenticated
   grant should be encoded back into the migration files so the two stop
   diverging (fixes the root drift, not just the symptom).
4. Only then, gated prod apply → immediately re-run `probe-rls-smoke` per the
   RLS-NULL-policy incident rule.

## Risk notes
- F1 is the only finding with live user impact (early exposure of scheduled
  deals) and could ship as a tiny standalone fix (drop `deals_public_read_live`)
  ahead of the larger consolidation, if desired.
- Keep at least one permissive public-read policy at all times so consumer feeds
  never break mid-migration.
- `SECURITY DEFINER` + `SET search_path = public` + `STABLE` matches existing
  safe helpers; the function returns a boolean and cannot leak `owner_id`.

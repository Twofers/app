-- Consolidate the `deals` RLS policies (fixes F1 + F3; reconciles drift).
--
-- ⚠️  APPLY TO THE TEST PROJECT (zsuzrerdailvylccqtds) FIRST, then run
--     `node scripts/probe-deals-rls.mjs`, `node scripts/probe-rls-smoke.mjs`,
--     and `npm run test:db` before any gated production apply. RLS-sensitive.
--     See docs/plans/deals-select-rls-drift-fix-proposal.md.
--
-- WHY ─────────────────────────────────────────────────────────────────────────
-- A 2026-07-11 prod pg_policies probe found ~14 `deals` policies (migration
-- files define far fewer): three overlapping public-read policies (one, F1,
-- missing the start_time gate → future-scheduled deals leaked early) and several
-- owner policies whose USING/WITH CHECK inline `EXISTS (SELECT 1 FROM businesses
-- ... owner_id = auth.uid())`. Since the PII column-grant migration
-- (20260705120000) revoked `businesses.owner_id` from clients, evaluating those
-- policies needs a privilege the caller lacks, so on a migrations-only schema
-- EVERY client `deals` SELECT fails at plan time with
-- `42501 permission denied for table businesses` (finding F3, reproduced on the
-- test project). Prod only works because its `authenticated` role can still read
-- `businesses` — itself drift.
--
-- FIX ─────────────────────────────────────────────────────────────────────────
--  1. `is_business_owner(uuid)` SECURITY DEFINER helper reads `businesses` with
--     definer privileges (row_security off), so policies stop referencing the
--     ungranted column and the plan-time 42501 disappears. Mirrors the existing
--     `is_active_redeemer_for_business` / `get_my_business` pattern. owner_id is
--     NOT re-granted to clients.
--  2. Collapse the three public-read policies into ONE correct definition that
--     keeps the start_time gate (removes F1).
--  3. Re-express the owner CRUD policies through the helper under stable names.
--
-- LEFT UNTOUCHED (correct as-is): "Users can read deals they claimed", and the
-- RESTRICTIVE redeemer_deals_* guards (their functions are SECURITY DEFINER, so
-- they never triggered the 42501 and they still constrain redeemer sessions).
--
-- ⚠️  BEHAVIOR DECISIONS (Dan, 2026-07-11): prod's manual `deals_owner_crud` /
--     `business manage own deals` (ALL) policies had silently REMOVED two
--     restrictions the migrations intended. Chosen settings:
--       (a) billing-v4 subscription gate (trial/active) on owner read/write —
--           OFF (kept as commented `-- (a)` blocks). Owners keep access to their
--           deals regardless of billing status; billing is enforced in the app /
--           edge layer where it can fail gracefully.
--       (b) ended-only delete (20260730120000) — ON. Owners can only delete
--           already-ended deals (matches the app; hardens against a crafted
--           request deleting a live/claimed deal).

-- 1) Owner-check helper ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT p_business_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = p_business_id
        AND b.owner_id = (SELECT auth.uid())
    );
$$;

-- Supabase grants EXECUTE to anon by default; REVOKE FROM PUBLIC alone does not
-- remove it (verified live 2026-06-10). Revoke anon explicitly.
REVOKE EXECUTE ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated;

-- 2) Drop the drifted / duplicated / businesses-referencing policies ---------
--    (IF EXISTS: a no-op for whichever names are absent on a given environment;
--     the manual ALL policies exist only on prod, the named ones only in the
--     migrations lineage.)
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_public_read_live"                ON public.deals; -- F1 (also 20260812120000)
DROP POLICY IF EXISTS "public view active deals"             ON public.deals; -- duplicate public read
DROP POLICY IF EXISTS "Anyone can read active deals"         ON public.deals; -- replaced below
DROP POLICY IF EXISTS "Businesses can read their own deals"  ON public.deals; -- inlined businesses ref
DROP POLICY IF EXISTS "Businesses can insert their own deals" ON public.deals;
DROP POLICY IF EXISTS "Businesses can update their own deals" ON public.deals;
DROP POLICY IF EXISTS "Businesses can delete ended own deals" ON public.deals;
DROP POLICY IF EXISTS "deals_owner_crud"                     ON public.deals; -- prod-only manual drift
DROP POLICY IF EXISTS "business manage own deals"            ON public.deals; -- prod-only manual drift

-- Idempotent re-run guard for this migration's own canonical names.
DROP POLICY IF EXISTS "deals_public_read"  ON public.deals;
DROP POLICY IF EXISTS "deals_owner_select" ON public.deals;
DROP POLICY IF EXISTS "deals_owner_insert" ON public.deals;
DROP POLICY IF EXISTS "deals_owner_update" ON public.deals;
DROP POLICY IF EXISTS "deals_owner_delete" ON public.deals;

-- 3) Canonical policy set ----------------------------------------------------

-- Public discovery: live deals only (keeps the start_time gate that F1 dropped).
CREATE POLICY "deals_public_read"
  ON public.deals FOR SELECT
  USING (is_active = true AND start_time <= now() AND end_time > now());

-- Owner read of own deals (via the helper — no businesses grant needed).
CREATE POLICY "deals_owner_select"
  ON public.deals FOR SELECT
  TO authenticated
  USING (
    public.is_business_owner(business_id)
    -- (a) To restore the billing-v4 trial/active gate, AND-in:
    -- AND EXISTS (SELECT 1 FROM public.business_profiles bp
    --            WHERE (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    --              AND bp.subscription_status IN ('trial','active'))
  );

-- Owner insert.
CREATE POLICY "deals_owner_insert"
  ON public.deals FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_business_owner(business_id)
    -- (a) trial/active gate: AND EXISTS (... business_profiles ...)
  );

-- Owner update.
CREATE POLICY "deals_owner_update"
  ON public.deals FOR UPDATE
  TO authenticated
  USING (public.is_business_owner(business_id))
  WITH CHECK (
    public.is_business_owner(business_id)
    -- (a) trial/active gate: AND EXISTS (... business_profiles ...)
  );

-- Owner delete — ended-only (decision (b) ON). The app only ever deletes ended
-- deals (canDeleteOldDeal requires end_time <= now()), and service-role deletes
-- bypass RLS, so this only hardens against a hand-crafted client request
-- deleting a live/claimed deal. Set back to just is_business_owner(business_id)
-- to allow deleting any own deal.
CREATE POLICY "deals_owner_delete"
  ON public.deals FOR DELETE
  TO authenticated
  USING (
    public.is_business_owner(business_id)
    AND end_time <= now()
  );

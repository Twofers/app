-- Public business lifecycle predicate + database-authoritative publish gate
-- (audit F-002 + F-001).
--
-- ⚠️  APPLY TO THE TEST PROJECT FIRST, then run `node scripts/probe-rls-smoke.mjs`,
--     `node scripts/probe-deals-rls.mjs`, and `npm run test:db` before any gated
--     production apply. RLS-sensitive.
--
-- F-002 ──────────────────────────────────────────────────────────────────────
-- The businesses SELECT row policy has been `USING (true)` since the initial
-- schema (20250127000000): every row — including pending_verification,
-- rejected, and draft rows — was publicly enumerable (columns restricted by
-- 20260705120000, rows not at all). The nearby_* RPCs are SECURITY INVOKER,
-- so fixing the row policy fixes them too.
--
-- Visible set decision: hide the PRE-APPROVAL states (draft,
-- pending_verification, rejected) — the impersonation/leak surface the audit
-- flagged. Post-approval lifecycle states (active, trialing, limited_trial,
-- past_due, trial_expired, canceled, suspended, disabled, archived) stay
-- readable so existing claims, favorites, and wallets keep resolving business
-- names for businesses that were legitimately public when the customer
-- interacted with them. Hiding suspended/disabled/archived from discovery is
-- a possible follow-up (needs a claims-aware exception first).
--
-- The rule lives in ONE helper (is_publicly_visible_business) shared by the
-- businesses row policy and the deals publish gate below, so the status list
-- cannot drift between them.
--
-- Owners must keep seeing their own row regardless of status: account
-- settings, use-business-locations, and business-setup's INSERT..RETURNING
-- read the table directly, and a fresh self-serve business is ALWAYS
-- pending_verification (column default + 20260804120000 column locks).
-- businesses.status is NOT NULL with a CHECK constraint (20260730125000), so
-- no NULL-status legacy rows exist.
--
-- F-001 ──────────────────────────────────────────────────────────────────────
-- deals_owner_insert / deals_owner_update (20260812130000) check ownership
-- only, so a modified client could INSERT/UPDATE a deal directly into live
-- state, bypassing the approval/terms/billing checks the official path
-- (publish-offer-version → service-role RPC) enforces. Gate LIVE-CAPABLE
-- rows (is_active AND end_time > now()) on the canonical
-- can_business_publish() helper AND on public business visibility —
-- can_business_publish alone does NOT block pending_verification when an
-- active subscription exists (20260730127000 checks status only against
-- suspended/disabled/rejected/archived), so without the visibility check a
-- paying-but-unreviewed business could publish into the public feed
-- (deals_public_read has no businesses join).
--
-- Owners can always create inactive drafts, pause/deactivate, and edit ended
-- deals — per Dan's 2026-07-11 decision (a) owners never lose access to their
-- own deals; only the transition into publicly-live state is gated. Official
-- server paths use the service role and bypass RLS, so publish-offer-version,
-- edit-deal, and recurring offers are unaffected.

BEGIN;

-- 0) One shared definition of "publicly visible business" ------------------
CREATE OR REPLACE FUNCTION public.is_publicly_visible_business(p_business_id uuid)
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
        AND b.status NOT IN ('draft', 'pending_verification', 'rejected')
    );
$$;

-- Callable by everyone: it powers the anon-facing businesses policy. It leaks
-- only a boolean about a uuid the caller already has.
REVOKE ALL ON FUNCTION public.is_publicly_visible_business(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_publicly_visible_business(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.is_publicly_visible_business(uuid) IS
  'Audit F-002: single source of truth for which business lifecycle states are publicly visible (pre-approval states draft/pending_verification/rejected are hidden). Used by the businesses public SELECT policy and the deals publish gate.';

-- 1) F-002: public businesses row predicate --------------------------------
-- Drop the known permissive SELECT policies by name AND sweep any drifted,
-- manually-created permissive SELECT policy: permissive policies OR together,
-- and prod has a documented history of hand-created policies that exist in no
-- migration file (~14 were found on deals, 2026-07-11). The RESTRICTIVE
-- redeemer guard (20260712120000) is deliberately untouched.
DROP POLICY IF EXISTS "Anyone can read businesses" ON public.businesses;
DROP POLICY IF EXISTS "businesses_public_read"     ON public.businesses;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'businesses'
      AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.businesses', pol.policyname);
  END LOOP;
END $$;

-- Anon sessions: auth.uid() is NULL, the owner clause is never true, and the
-- visibility helper alone decides.
CREATE POLICY "businesses_public_read"
  ON public.businesses FOR SELECT
  USING (
    public.is_publicly_visible_business(id)
    OR owner_id = (SELECT auth.uid())
  );

COMMENT ON POLICY "businesses_public_read" ON public.businesses IS
  'Audit F-002: pre-approval businesses (draft/pending_verification/rejected) are hidden from everyone except their owner. Post-approval lifecycle states stay readable so existing claims/favorites keep resolving. Column grants (20260705120000) still restrict which columns clients see.';

-- 2) F-001: live-state transitions require canonical publish eligibility ----
DROP POLICY IF EXISTS "deals_owner_insert" ON public.deals;
CREATE POLICY "deals_owner_insert"
  ON public.deals FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_business_owner(business_id)
    AND (
      -- Non-live rows (drafts, deactivated, already-ended) are always allowed.
      NOT (is_active = true AND end_time > now())
      -- Live-capable rows require the same eligibility the official publish
      -- path checks (approval, terms, suspension, billing/entitlement) AND a
      -- publicly-visible business (canPublish alone does not exclude
      -- pending_verification when a subscription exists).
      OR (
        COALESCE((public.can_business_publish(business_id) ->> 'canPublish')::boolean, false)
        AND public.is_publicly_visible_business(business_id)
      )
    )
  );

DROP POLICY IF EXISTS "deals_owner_update" ON public.deals;
CREATE POLICY "deals_owner_update"
  ON public.deals FOR UPDATE
  TO authenticated
  USING (public.is_business_owner(business_id))
  WITH CHECK (
    public.is_business_owner(business_id)
    AND (
      NOT (is_active = true AND end_time > now())
      OR (
        COALESCE((public.can_business_publish(business_id) ->> 'canPublish')::boolean, false)
        AND public.is_publicly_visible_business(business_id)
      )
    )
  );

COMMENT ON POLICY "deals_owner_insert" ON public.deals IS
  'Audit F-001: direct writes cannot create a publicly-live deal unless can_business_publish() passes AND the business is publicly visible. Drafts/inactive/ended rows are unrestricted for owners.';
COMMENT ON POLICY "deals_owner_update" ON public.deals IS
  'Audit F-001: direct updates cannot flip a deal into publicly-live state unless can_business_publish() passes AND the business is publicly visible. Pausing/deactivating/editing ended deals stays unrestricted for owners.';

COMMIT;

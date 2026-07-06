-- One-time repair for production data affected by two bugs fixed in this
-- release:
--
--  1. get-business-onboarding-context previously seeded business_subscriptions
--     with trial_end = NULL for every trial (hardcoded, ignoring the
--     trial_days the admin actually approved), so trial businesses that
--     finished onboarding have an eternal trial with no expiration date.
--  2. The Stripe webhook previously skipped the businesses.access_level
--     update for canceled/expired/past-due statuses instead of downgrading,
--     so a canceled or expired business can be stuck at access_level='paid'
--     (or 'full_trial'/'limited_trial') indefinitely, and never got a
--     location_entitlements row at all, so the app gate and publish checks
--     never actually enforced the downgrade either.
--
-- This migration only UPDATEs/INSERTs rows into their already-correct state
-- per the new code path (supabase/functions/_shared/business-location-entitlement-sync.ts).
-- It does not delete anything and is safe to run more than once.
--
-- Do not apply without Dan's explicit approval (CLAUDE.md hard gate on
-- production migrations). Review the two SELECT-only sections first to see
-- exactly which rows will change before running the UPDATE/INSERT sections.

BEGIN;

-- ---------------------------------------------------------------------------
-- Part 1: backfill trial_end for trials that never got an expiration date.
-- Uses the most recently reviewed business_applications row for the business
-- (source of the originally-approved trial_days) and trial_start (falling
-- back to updated_at, the best available signal for when the trial began).
-- ---------------------------------------------------------------------------
WITH latest_application AS (
  SELECT DISTINCT ON (business_id)
    business_id,
    trial_days
  FROM public.business_applications
  WHERE business_id IS NOT NULL
    AND trial_days IS NOT NULL
  ORDER BY business_id, reviewed_at DESC NULLS LAST, created_at DESC
)
UPDATE public.business_subscriptions bs
SET
  trial_start = COALESCE(bs.trial_start, bs.updated_at),
  trial_end = COALESCE(bs.trial_start, bs.updated_at) + make_interval(days => la.trial_days),
  updated_at = now()
FROM latest_application la
WHERE bs.business_id = la.business_id
  AND bs.app_access_status IN ('trialing', 'trial_limited')
  AND bs.trial_end IS NULL;

-- ---------------------------------------------------------------------------
-- Part 2: downgrade businesses stuck at a paid/trial access_level whose
-- business_subscriptions row already shows a terminal status. Comped/internal
-- accounts are explicitly excluded, matching resolveBusinessAccessLevelForAppAccessStatus.
-- ---------------------------------------------------------------------------
UPDATE public.businesses b
SET
  access_level = 'none',
  status = CASE WHEN bs.app_access_status = 'canceled' THEN 'canceled' ELSE b.status END,
  updated_at = now()
FROM public.business_subscriptions bs
WHERE bs.business_id = b.id
  AND bs.app_access_status IN ('canceled', 'expired', 'blocked', 'suspended')
  AND b.access_level IN ('paid', 'full_trial', 'limited_trial')
  AND b.access_level NOT IN ('admin_comped', 'partner_comped', 'internal_test');

-- ---------------------------------------------------------------------------
-- Part 3: mirror the same downgrade into location_entitlements for each
-- affected business's primary (oldest) business_locations row, so the app
-- gate and publish checks actually enforce it retroactively. Businesses with
-- no business_locations row yet are left alone — the next live sync call
-- (seedBusinessSubscription / the Stripe webhook / the expiry sweep) will
-- create one on demand via ensurePrimaryBusinessLocationId.
-- ---------------------------------------------------------------------------
WITH affected AS (
  SELECT bs.business_id
  FROM public.business_subscriptions bs
  JOIN public.businesses b ON b.id = bs.business_id
  WHERE bs.app_access_status IN ('canceled', 'expired', 'blocked', 'suspended')
    AND b.access_level = 'none'
),
primary_location AS (
  SELECT DISTINCT ON (bl.business_id)
    bl.business_id,
    bl.id AS business_location_id
  FROM public.business_locations bl
  JOIN affected a ON a.business_id = bl.business_id
  ORDER BY bl.business_id, bl.created_at ASC, bl.id ASC
)
INSERT INTO public.location_entitlements (
  business_location_id,
  status,
  entitlement_provider,
  suspended_at,
  suspension_reason,
  updated_at
)
SELECT
  pl.business_location_id,
  'canceled_suspended',
  'backfill_20260803',
  now(),
  'billing_access_state_backfill',
  now()
FROM primary_location pl
ON CONFLICT (business_location_id) DO UPDATE SET
  status = 'canceled_suspended',
  suspended_at = now(),
  suspension_reason = 'billing_access_state_backfill',
  updated_at = now();

COMMIT;

-- Merchant-access lockout audit  (READ-ONLY -- SELECT only, safe to run in the
-- Supabase SQL editor against production).
--
-- Purpose: list every business location that would LOSE access to merchant
-- tools (deal create/publish) under the entitlement gate the App Store build
-- now enforces.
--
-- The allowed ("access granted") statuses are defined in lib/merchant-access.ts
-- (ALLOWED_STATUSES):
--     trial_active, admin_trial_active, trial_canceling,
--     pro_active, pro_canceling, paid_active, paid_canceling
--
-- Anything else is blocked. Critically, a location with NO location_entitlements
-- row is ALSO blocked: lib/billing/entitlements.ts defaults a missing row to
-- status 'trial_eligible', which is not in the allowed set. That is the most
-- likely silent-lockout case for existing pilot businesses, so this query uses a
-- LEFT JOIN and treats a missing row as a lockout.

-- Query 1: locations that are blocked (missing row OR non-allowed status).
SELECT
  b.id                                         AS business_id,
  b.name                                       AS business_name,
  b.owner_id,
  bl.id                                        AS business_location_id,
  bl.name                                      AS location_name,
  COALESCE(le.status, '(no entitlement row)')  AS entitlement_status,
  le.trial_ends_at,
  le.current_period_ends_at,
  le.suspended_at,
  le.suspension_reason
FROM public.business_locations bl
JOIN public.businesses b
  ON b.id = bl.business_id
LEFT JOIN public.location_entitlements le
  ON le.business_location_id = bl.id
WHERE le.status IS NULL
   OR le.status NOT IN (
        'trial_active',
        'admin_trial_active',
        'trial_canceling',
        'pro_active',
        'pro_canceling',
        'paid_active',
        'paid_canceling'
      )
ORDER BY b.name, bl.name;

-- Query 2 (optional companion): businesses that have NO business_locations row
-- at all. These cannot be evaluated by the per-location entitlement gate and may
-- also fail merchant access depending on how the client resolves a null location.
SELECT
  b.id        AS business_id,
  b.name      AS business_name,
  b.owner_id,
  b.created_at
FROM public.businesses b
LEFT JOIN public.business_locations bl
  ON bl.business_id = b.id
WHERE bl.id IS NULL
ORDER BY b.created_at;

-- Query 3 (optional): full status breakdown, to sanity-check how many locations
-- sit in each entitlement status (missing rows shown as their own bucket).
SELECT
  COALESCE(le.status, '(no entitlement row)') AS entitlement_status,
  COUNT(*)                                    AS location_count
FROM public.business_locations bl
LEFT JOIN public.location_entitlements le
  ON le.business_location_id = bl.id
GROUP BY COALESCE(le.status, '(no entitlement row)')
ORDER BY location_count DESC;

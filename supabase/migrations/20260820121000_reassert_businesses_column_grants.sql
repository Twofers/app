-- Step 2 of 3 in the businesses column-grant repair.
--
-- Re-asserts the column-level SELECT model from 20260705120000, closing the
-- production over-grant described in 20260820120000.
--
-- DO NOT APPLY BEFORE 20260820120000. That migration moves ~30 RLS policies off
-- inline `businesses.owner_id` reads and onto SECURITY DEFINER helpers. Applying
-- this one first takes down owner deal CRUD, deal templates, menu items, poster
-- upload, redemption, merchant analytics and the AI ad surface.
--
-- WHAT PRODUCTION LOOKS LIKE NOW (verified 2026-07-19, read-only):
--   anon           - correctly limited to the granted column list.
--   authenticated  - holds a TABLE-level SELECT, so all 55 columns are readable
--                    by any signed-in user, including owner_id, business_email,
--                    contact_name, tone, admin_notes, risk_score, risk_level,
--                    suspension_reason, approved_by/suspended_by and the rest of
--                    the internal governance set.
-- No migration in this repo restores that grant; it is prod-only drift from a
-- hand-run statement. The approved test project is in the intended state.
--
-- HOW THE COLUMN LIST BELOW WAS DERIVED
-- Every one of the 55 live columns was enumerated and classified:
--   * 17 granted by 20260705120000
--   * claim_notifications_enabled  (20260713120000)
--   * is_demo                      (20260719120000)
--   * repeat_claim_policy_type, repeat_claim_cooldown_days — added by
--     20260721120000_deal_wallet_redemption_rules.sql but NEVER granted. They
--     are read today by app/(tabs)/account/index.tsx (merchant repeat-claim
--     settings) and, critically, by supabase/functions/claim-deal/index.ts on a
--     caller-JWT client, i.e. the claim path for every shopper. They are claim
--     rules, not PII, so they are added to the grant list here. Omitting them
--     would break deal claiming.
--   * The remaining 34 are read by NO code path running as anon/authenticated
--     and stay ungranted. That set is deliberately withheld, not overlooked:
--     owner_id, business_email, contact_name, tone (the original PII four),
--     plus admin_notes, risk_score, risk_level, status, access_level,
--     verification_status, can_publish_cached, approved_by, first_approved_at,
--     suspended_at, suspended_by, suspension_reason, source,
--     source_onboarding_request_id, launch_area_id, current_profile_version,
--     profile_completion_score, last_profile_completed_at,
--     last_sensitive_edit_at, subscription_tier, updated_at, and the unused
--     address-component set (address_line1, address_line2, city, state,
--     postal_code, country, public_email, website_url, instagram_url).
--
-- Owners continue to read their own full row through get_my_business()
-- (SECURITY DEFINER, verified working in production and returning all 55
-- columns). Any future column defaults to ungranted — add it here explicitly.
--
-- ANON DEPENDENCY: public.nearby_businesses() and public.nearby_deals()
-- (20260802141000) are SECURITY INVOKER and are granted EXECUTE to anon and
-- authenticated. Their bodies read businesses.{id, name, location, latitude,
-- longitude}. All five are in the grant list below; do not remove any of them
-- without also reworking those two discovery RPCs, or both 42501 for every
-- caller including logged-out browse.

BEGIN;

REVOKE SELECT ON public.businesses FROM anon, authenticated;

-- Columns readable by BOTH roles (logged-out browse needs these).
GRANT SELECT (
  -- 20260705120000 baseline
  id,
  name,
  address,
  location,
  latitude,
  longitude,
  phone,
  hours_text,
  short_description,
  category,
  preferred_locale,
  logo_url,
  website,
  instagram_handle,
  facebook_url,
  pickup_note,
  created_at,
  -- 20260719120000
  is_demo,
  -- 20260721120000 columns, granted here for the first time (see note above)
  repeat_claim_policy_type,
  repeat_claim_cooldown_days
) ON public.businesses TO anon, authenticated;

-- authenticated ONLY, matching the original grant in 20260713120000. The single
-- reader is app/(tabs)/account/index.tsx, a signed-in owner screen, so there is
-- no reason to widen this to anon while re-asserting.
GRANT SELECT (claim_notifications_enabled) ON public.businesses TO authenticated;

COMMIT;

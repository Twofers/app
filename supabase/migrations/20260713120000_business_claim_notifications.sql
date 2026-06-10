-- Minimum business notifications (spec 11.8): new-claim and sold-out owner pushes.
--
-- 1. businesses.claim_notifications_enabled — owner-side preference, default ON.
--    The owner toggles it from the business Account screen; the claim-deal edge
--    function checks it before sending any owner push. The explicit column-level
--    SELECT grant is required because 20260705120000_businesses_pii_column_grants.sql
--    replaced the table-level SELECT grant with an explicit column list.
--    (UPDATE was never column-restricted, so the existing owner-update RLS policy
--    already covers writes to the new column.)
-- 2. deals.claim_push_last_sent_at — suppression-window state so a burst of claims
--    sends at most one "new claim" push per deal per 10-minute window. Written by
--    the claim-deal edge function (service role) only; clients never touch it.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS claim_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.businesses.claim_notifications_enabled IS
  'Owner push notifications for new claims / sold-out deals. Default on; toggled from the business Account screen.';

GRANT SELECT (claim_notifications_enabled) ON public.businesses TO authenticated;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS claim_push_last_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.deals.claim_push_last_sent_at IS
  'Last time a "new claim" owner push was sent for this deal (suppression window). Service-role writes only (claim-deal edge function).';

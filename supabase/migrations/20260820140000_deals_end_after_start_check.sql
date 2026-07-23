-- Reject deals whose end time does not follow their start time.
--
-- Observed 2026-07-22: a recovered AI draft reopened with its start advanced to
-- "now" while its end stayed on the saved value, producing an inverted window
-- (start 9:28 AM, end 1:00 AM). Nothing downstream caught it. The client guards
-- were the only checks: publish_offer_versioned_deal inserts start_time and
-- end_time verbatim, and public.deals had no ordering constraint, so an
-- inverted window persisted as a deal that was already expired when written.
--
-- end_time is nullable (recurring deals derive their window from days_of_week
-- and the minute columns), so NULL passes.
--
-- Added NOT VALID on purpose: enforced for every INSERT and UPDATE from here
-- on, without scanning or failing on rows that predate it. Audit the existing
-- rows first:
--
--   SELECT id, business_id, start_time, end_time, is_active
--   FROM public.deals
--   WHERE end_time IS NOT NULL AND end_time <= start_time
--   ORDER BY start_time DESC;
--
-- Once those are repaired or retired, promote the constraint with:
--
--   ALTER TABLE public.deals VALIDATE CONSTRAINT deals_end_after_start_check;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_end_after_start_check;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_end_after_start_check
    CHECK (end_time IS NULL OR end_time > start_time)
    NOT VALID;

COMMENT ON CONSTRAINT deals_end_after_start_check ON public.deals IS
  'A deal must end after it starts. NOT VALID until pre-existing inverted rows are audited and repaired, then VALIDATE CONSTRAINT.';

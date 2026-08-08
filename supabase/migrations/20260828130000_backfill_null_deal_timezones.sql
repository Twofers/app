-- Backfill deals.timezone where it is NULL.
--
-- Companion to 20260828120000. That migration made the insight RPCs resolve
-- deal tz -> the business's most recent non-null deal tz -> 'UTC'. Device
-- verification immediately afterwards showed the merchant-facing number was
-- STILL wrong ("Busiest around 3:00 AM local" for claims made ~10:40 PM
-- America/Chicago), because the fallback has nothing to borrow: the test
-- business has 24 deals and ZERO recurring ones ("Recurring: showing 0 of 24"),
-- and only recurring deals ever stored a timezone. Any business that never
-- created a recurring deal is in the same position, so for them the chain
-- still lands on 'UTC' and the panel still calls that "local".
--
-- There is no other source to derive from: `businesses` has no timezone
-- column, `business_profiles.timezone` was never created, and deriving a zone
-- from lat/lng needs a tz shapefile Postgres does not have here.
--
-- So: fill the NULLs with the value the column itself already declares as its
-- DEFAULT. `deals.timezone` has been `TEXT DEFAULT 'America/Chicago'` since
-- 20260127000001; those rows are only NULL because the client explicitly wrote
-- null for one-time deals, overriding that default. This restores the intended
-- default rather than inventing a new policy.
--
-- ACCURACY NOTE, read before applying: this ASSERTS America/Chicago for every
-- historical deal that has no timezone. That is correct for the current market
-- (DFW) and is strictly better than the 'UTC' those rows resolve to today —
-- UTC is wrong for every US merchant, whereas this is wrong only for a
-- merchant outside Central time. If Twofer expands beyond Central before this
-- is applied, prefer capturing a real per-business timezone instead (see the
-- durable follow-up in docs/plans/business-ui-consistency-plan-2026-08-07.md).
--
-- Scope: historical repair only. New deals carry a real timezone from the
-- client as of the same-dated change to app/create/ai.tsx, so this is expected
-- to be a one-time fix, not a recurring cleanup.
--
-- Idempotent: only touches rows still NULL; re-running is a no-op.
--
-- Do not apply to production without Dan's explicit migration approval.

BEGIN;

DO $$
DECLARE
  v_default text := 'America/Chicago';
  v_updated bigint;
BEGIN
  -- Never write a value the CHECK constraint from 20260703120004 would reject.
  IF NOT public.is_valid_iana_timezone(v_default) THEN
    RAISE EXCEPTION 'backfill aborted: % is not a valid IANA timezone on this server', v_default;
  END IF;

  UPDATE public.deals
  SET timezone = v_default
  WHERE timezone IS NULL OR trim(timezone) = '';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'deals.timezone backfilled on % row(s) to %', v_updated, v_default;
END $$;

COMMIT;

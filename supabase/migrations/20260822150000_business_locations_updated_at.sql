-- Add the business_locations.updated_at column the merchant dashboard has
-- always asked for but which was never created.
--
-- get-business-onboarding-context selects
--   id,business_id,name,address,phone,lat,lng,created_at,updated_at
-- from business_locations, but 20260530120000 created that table with only
-- created_at. Every call that reaches this query dies with
--   42703  column business_locations.updated_at does not exist
-- and the merchant gets HTTP 500 "Could not load business onboarding context."
--
-- This never surfaced because two upstream bugs meant no merchant ever reached
-- the query: the claim RPC aborted with an ambiguous-column error, and owners
-- whose application had advanced to trial_active could not claim at all. The
-- moment a claim succeeds, this is the next thing that breaks -- so it must be
-- fixed alongside them or merchant onboarding is still broken end to end.
--
-- Purely additive: a nullable-safe column with a default, backfilled from
-- created_at so existing rows carry a sensible value. No data is rewritten
-- beyond that backfill and no behavior changes for any other caller.

BEGIN;

ALTER TABLE public.business_locations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Existing rows should report their creation time rather than the migration time.
UPDATE public.business_locations
   SET updated_at = created_at
 WHERE updated_at > created_at;

-- Keep it accurate on future writes. set_updated_at() is the trigger helper this
-- schema already uses elsewhere; create a local equivalent only if absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $body$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $body$;
    $fn$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS business_locations_set_updated_at ON public.business_locations;
CREATE TRIGGER business_locations_set_updated_at
  BEFORE UPDATE ON public.business_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

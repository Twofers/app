-- Bind claims and redemptions to immutable OfferVersion ids.
--
-- Drafted for the AI ad generation master plan. Do not apply without Dan's
-- explicit migration approval. Depends on
-- 20260723120000_offer_versions_foundation.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_claim_offer_version_ids()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer_definition_id uuid;
  v_offer_version_id uuid;
BEGIN
  IF NEW.deal_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.offer_definition_id IS NOT NULL AND NEW.offer_version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.offer_definition_id, d.offer_version_id
  INTO v_offer_definition_id, v_offer_version_id
  FROM public.deals d
  WHERE d.id = NEW.deal_id;

  NEW.offer_definition_id := COALESCE(NEW.offer_definition_id, v_offer_definition_id);
  NEW.offer_version_id := COALESCE(NEW.offer_version_id, v_offer_version_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_claim_offer_version_ids ON public.deal_claims;
CREATE TRIGGER trg_set_claim_offer_version_ids
BEFORE INSERT OR UPDATE OF deal_id, offer_definition_id, offer_version_id
ON public.deal_claims
FOR EACH ROW
EXECUTE FUNCTION public.set_claim_offer_version_ids();

CREATE OR REPLACE FUNCTION public.set_redemption_offer_version_ids()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer_definition_id uuid;
  v_offer_version_id uuid;
BEGIN
  IF NEW.offer_definition_id IS NOT NULL AND NEW.offer_version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(dc.offer_definition_id, d.offer_definition_id),
    COALESCE(dc.offer_version_id, d.offer_version_id)
  INTO v_offer_definition_id, v_offer_version_id
  FROM public.deal_claims dc
  LEFT JOIN public.deals d
    ON d.id = COALESCE(NEW.deal_id, dc.deal_id)
  WHERE dc.id = NEW.claim_id
  LIMIT 1;

  IF v_offer_definition_id IS NULL OR v_offer_version_id IS NULL THEN
    SELECT d.offer_definition_id, d.offer_version_id
    INTO v_offer_definition_id, v_offer_version_id
    FROM public.deals d
    WHERE d.id = NEW.deal_id
    LIMIT 1;
  END IF;

  NEW.offer_definition_id := COALESCE(NEW.offer_definition_id, v_offer_definition_id);
  NEW.offer_version_id := COALESCE(NEW.offer_version_id, v_offer_version_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_redemption_offer_version_ids ON public.redemptions;
CREATE TRIGGER trg_set_redemption_offer_version_ids
BEFORE INSERT OR UPDATE OF claim_id, deal_id, offer_definition_id, offer_version_id
ON public.redemptions
FOR EACH ROW
EXECUTE FUNCTION public.set_redemption_offer_version_ids();

UPDATE public.deal_claims dc
SET
  offer_definition_id = COALESCE(dc.offer_definition_id, d.offer_definition_id),
  offer_version_id = COALESCE(dc.offer_version_id, d.offer_version_id)
FROM public.deals d
WHERE d.id = dc.deal_id
  AND (dc.offer_definition_id IS NULL OR dc.offer_version_id IS NULL);

UPDATE public.redemptions r
SET
  offer_definition_id = COALESCE(r.offer_definition_id, dc.offer_definition_id, d.offer_definition_id),
  offer_version_id = COALESCE(r.offer_version_id, dc.offer_version_id, d.offer_version_id)
FROM public.deal_claims dc
LEFT JOIN public.deals d
  ON d.id = dc.deal_id
WHERE dc.id = r.claim_id
  AND (r.offer_definition_id IS NULL OR r.offer_version_id IS NULL);

UPDATE public.redemptions r
SET
  offer_definition_id = COALESCE(r.offer_definition_id, d.offer_definition_id),
  offer_version_id = COALESCE(r.offer_version_id, d.offer_version_id)
FROM public.deals d
WHERE d.id = r.deal_id
  AND (r.offer_definition_id IS NULL OR r.offer_version_id IS NULL);

COMMIT;

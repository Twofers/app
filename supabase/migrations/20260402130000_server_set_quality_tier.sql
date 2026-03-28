-- Ensure quality_tier is always computed server-side, never trusted from client.
CREATE OR REPLACE FUNCTION public.set_quality_tier_on_deal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.title IS NOT NULL AND public.is_strong_deal_offer(NEW.title, NEW.description) THEN
    NEW.quality_tier := 'strong';
  ELSE
    NEW.quality_tier := 'acceptable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_quality_tier_on_deal ON public.deals;
CREATE TRIGGER trg_set_quality_tier_on_deal
BEFORE INSERT OR UPDATE OF title, description ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.set_quality_tier_on_deal();

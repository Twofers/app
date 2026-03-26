-- Enforce curated "strong deal only" quality at write-time.
-- Applies to inserts and title/description edits on `deals`.

CREATE OR REPLACE FUNCTION public.is_strong_deal_offer(
  p_title TEXT,
  p_description TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text TEXT := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, ''));
  v_match TEXT;
BEGIN
  -- Minimum 40% for any explicit percent-based offer.
  FOR v_match IN
    SELECT m[1]
    FROM regexp_matches(v_text, '(\d{1,3})\s*%', 'g') AS m
  LOOP
    IF v_match::INT < 40 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  -- Clear high-value language requirement.
  IF v_text ~* '\mbogo\M'
    OR v_text ~* '2\s*[- ]?\s*for\s*1'
    OR v_text ~* '2\s*for\s*one'
    OR v_text ~* 'two\s*for\s*one'
    OR v_text ~* 'buy\s*one\s*get\s*one'
    OR v_text ~* 'buy\s*1\s*get\s*1'
    OR v_text ~* 'second\s+item\s+free'
    OR v_text ~* 'second\s+one\s+free'
    OR v_text ~* '2nd\s+item\s+free'
    OR v_text ~* 'second\s+half\s+off'
    OR v_text ~* '50\s*%\s*off\s+the\s+second'
    OR v_text ~* '(40|[4-9][0-9]|100)\s*%\s*off'
  THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_strong_deal_only_guardrail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_strong_deal_offer(NEW.title, NEW.description) THEN
    RAISE EXCEPTION 'Twofer only allows strong deals (40%% or more value). Try rephrasing to a clear BOGO.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_strong_deal_only_guardrail ON public.deals;
CREATE TRIGGER trg_enforce_strong_deal_only_guardrail
BEFORE INSERT OR UPDATE OF title, description ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_strong_deal_only_guardrail();

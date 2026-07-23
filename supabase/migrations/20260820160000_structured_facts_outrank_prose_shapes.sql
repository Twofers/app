-- Let a deal's own validated facts outrank how the AI happened to word the title.
--
-- R13 (20260721170000) added two prose rejections, 1a SECOND-ITEM and 1b
-- ENTIRE-ORDER, ABOVE the structured accept. Because they RETURN FALSE before
-- the structured branch is ever reached, a deal whose merchant-entered,
-- already-validated facts are a clean 40% offer was still blocked purely by
-- wording. Measured live against production with identical structured facts
-- (deal_type PERCENT_OFF_SINGLE_ITEM, discount_percent 40):
--
--   "40% off all drinks today"    -> REJECT
--   "40% off your entire order"   -> REJECT
--   "40% off any latte"           -> PASS
--   "Save big on lattes today"    -> PASS
--
-- So copy that states no offer at all published, while accurate copy did not.
-- That is the same failure R13 itself was written to remove -- publishing gated
-- on the model's word choice -- reintroduced one step higher up.
--
-- Fix: move the FREE ITEM / STRUCTURED-STRONG accept above the two shape
-- rejections. Nothing else moves and no pattern changes.
--
-- The shape rejections still apply whenever there are no usable structured
-- facts, which is the prose-only path used by set_quality_tier_on_deal, so
-- their intent is preserved where they are the only signal available.
--
-- This cannot weaken the guard: structured_offer_is_strong returns TRUE only for
-- BUY_ONE_GET_ONE_FREE / BUY_ONE_GET_SOMETHING_FREE, a genuinely free item
-- (free_item_quantity >= 1 with no partial discount), or discount_percent
-- >= 39.5. A second-item-50%-off returns NULL, not TRUE, so it still falls
-- through to 1a and is still rejected. Conditional "buy X + N% off Y" ordering
-- versus the accept is unchanged -- it already sat below it.
--
-- SIGNATURE NOTE: the argument list below is byte-for-byte the one R13 created.
-- CREATE OR REPLACE FUNCTION cannot change a function's argument list -- if it
-- differs at all, Postgres silently creates a SECOND OVERLOAD instead of
-- replacing, which is exactly how R13 left two copies of this function in
-- production and made every 2-argument call ambiguous (PGRST203). Do not adjust
-- the parameters here without dropping the old signature in the same migration.

CREATE OR REPLACE FUNCTION public.is_strong_deal_offer(
  p_title TEXT,
  p_description TEXT,
  p_deal_type TEXT DEFAULT NULL,
  p_discount_percent NUMERIC DEFAULT NULL,
  p_free_item_quantity NUMERIC DEFAULT NULL,
  p_free_item_discount_percent NUMERIC DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text TEXT;
  v_match TEXT;
  v_structured BOOLEAN;
BEGIN
  v_text := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, ''));
  v_structured := public.structured_offer_is_strong(
    p_deal_type, p_discount_percent, p_free_item_quantity, p_free_item_discount_percent
  );

  -- 1. FREE ITEM (prose) or STRUCTURED-STRONG -------------------------------
  -- Moved above the shape rejections: validated facts beat wording.
  IF v_text ~* '(^|\s)free\y'
     OR v_text ~* '\mon\s+the\s+house\M'
     OR v_text ~* '\mcomplimentary\M'
     OR v_text ~* '\mgratis\M'
     OR v_text ~* 'cortesía'
     OR v_text ~* 'de\s+regalo'
     OR v_text ~* 'invita\s+la\s+casa'
     OR v_text ~ '무료'
     OR v_text ~ '서비스'
     OR v_text ~ '공짜'
     OR v_structured IS TRUE          -- R13
  THEN
    RETURN TRUE;
  END IF;

  -- 2a. SECOND-ITEM DISCOUNT ------------------------------------------------
  IF v_text ~* 'buy\s+one\s+get\s+one\s+[0-9]{1,3}\s*%\s*off'
     OR v_text ~* 'buy\s+1\s+get\s+1\s+[0-9]{1,3}\s*%\s*off'
     OR v_text ~* 'second\s+(item|one|\w+)\s+half\s+off'
     OR v_text ~* '[0-9]{1,3}\s*%\s*off\s+(the\s+)?second'
     OR v_text ~* 'second\s+(item|one|\w+)\s+[0-9]{1,3}\s*%\s*off'
  THEN
    RETURN FALSE;
  END IF;

  -- 2b. ENTIRE-ORDER DISCOUNT -----------------------------------------------
  IF v_text ~* '[0-9]{1,3}\s*%\s*off\s+(your\s+)?(entire|whole)\s+order'
     OR v_text ~* '[0-9]{1,3}\s*%\s*off\s+(everything|all\s+(drinks|items|pastries|orders|food))'
  THEN
    RETURN FALSE;
  END IF;

  -- 3. CONDITIONAL DISCOUNT -------------------------------------------------
  IF v_text ~* 'buy\s+\S.{0,60}\s*\+\s*[0-9]{1,3}\s*%\s*off' THEN
    RETURN FALSE;
  END IF;

  -- 4. PERCENT FLOOR --------------------------------------------------------
  IF v_structured IS FALSE THEN
    RETURN FALSE;
  END IF;
  FOR v_match IN
    SELECT m[1] FROM regexp_matches(v_text, '([0-9]{1,3})\s*%', 'g') AS m
  LOOP
    IF v_match::INT < 40 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  -- 5. STRONG LANGUAGE ------------------------------------------------------
  IF v_text ~* '\mbogo\M'
    OR v_text ~* '2\s*[- ]?\s*for\s*[- ]?\s*1'
    OR v_text ~* '2\s*for\s*one'
    OR v_text ~* 'two\s*for\s*one'
    OR v_text ~* 'buy\s*one\s*get\s*one'
    OR v_text ~* 'buy\s*1\s*get\s*1'
    OR v_text ~* 'get\s+one\s+free'
    OR v_text ~* 'get\s+1\s+free'
    OR v_text ~* 'second\s+item\s+free'
    OR v_text ~* 'second\s+one\s+free'
    OR v_text ~* '2nd\s+item\s+free'
    OR v_text ~* 'second\s+half\s+off'
    OR v_text ~* 'second\s+\w+\s+half\s+off'
    OR v_text ~* '50\s*%\s*off\s+the\s+second'
    OR v_text ~* '(40|[4-9][0-9]|100)\s*%\s*off'
    OR v_text ~* 'compra\s+uno?\M.*gratis'
    OR v_text ~* 'lleva(te)?\s+(otro|el\s+segundo).*gratis'
    OR v_text ~* '2\s*(x|por)\s*1'
    OR v_text ~* 'dos\s+por\s+uno'
    OR v_text ~* '[4-9][0-9]\s*%\s*(de\s+)?descuento'
    OR v_text ~* 'mitad\s+de\s+precio'
    OR v_text ~* 'el\s+segundo\s+a\s+mitad'
    OR v_text ~ '1\s*\+\s*1'
    OR v_text ~ '[4-9][0-9]\s*%\s*할인'
    OR v_text ~ '하나\s*사면\s*하나'
    OR v_text ~ '반값'
  THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

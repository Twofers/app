-- Stop the entire-order scan rejecting ordinary single-item promo copy.
--
-- Step 1b matched "N% off all (drinks|items|pastries|orders|food)" alongside
-- "everything" and "entire/whole order". But "40% off all drinks" says which
-- items qualify, not how many get discounted -- a merchant writing it has a
-- normal single-item promo. It was rejected anyway, and because
-- dealQuality.strongGuard.entire_order existed in no locale file the message
-- fell back to "Twofer deals need to be at least 40% off or give something
-- free", telling a merchant who had configured exactly 40% off a single item
-- that their deal type was unsupported. Nothing pointed at the wording.
--
-- "everything" and "all orders" do describe the whole basket, so they stay.
--
-- This is the SQL half of a paired change. The client twin is
-- ENTIRE_ORDER_DISCOUNT_PATTERNS in lib/strong-deal-guard.ts and the two must
-- move together -- scripts/probe-strong-deal.mjs compares them against
-- production and is the check that catches drift.
--
-- Only the step-1b line changes; the rest of the function is byte-identical to
-- 20260820180000.
--
-- SIGNATURE NOTE: the argument list is byte-for-byte the existing one. CREATE OR
-- REPLACE FUNCTION cannot change an argument list -- if it differs at all,
-- Postgres creates a SECOND OVERLOAD rather than replacing, which is how R13
-- left two copies of this function in production and made every 2-argument call
-- ambiguous (PGRST203). Verified identical before applying.

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

  -- 1a. SECOND-ITEM DISCOUNT ------------------------------------------------
  IF v_text ~* 'buy\s+one\s+get\s+one\s+[0-9]{1,3}\s*%\s*off'
     OR v_text ~* 'buy\s+1\s+get\s+1\s+[0-9]{1,3}\s*%\s*off'
     OR v_text ~* 'second\s+(item|one|\w+)\s+half\s+off'
     OR v_text ~* '[0-9]{1,3}\s*%\s*off\s+(the\s+)?second'
     OR v_text ~* 'second\s+(item|one|\w+)\s+[0-9]{1,3}\s*%\s*off'
  THEN
    RETURN FALSE;
  END IF;

  -- 1b. ENTIRE-ORDER DISCOUNT -----------------------------------------------
  IF v_text ~* '[0-9]{1,3}\s*%\s*off\s+(your\s+)?(entire|whole)\s+order'
     OR v_text ~* '[0-9]{1,3}\s*%\s*off\s+(everything|all\s+orders)'
  THEN
    RETURN FALSE;
  END IF;

  -- 2. FREE ITEM (prose) or STRUCTURED-STRONG -------------------------------
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

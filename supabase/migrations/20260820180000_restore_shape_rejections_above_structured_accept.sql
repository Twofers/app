-- Restore the R13 ordering: shape rejections sit ABOVE the structured accept.
--
-- 20260820160000 moved the FREE ITEM / STRUCTURED-STRONG accept above the
-- SECOND-ITEM and ENTIRE-ORDER rejections, on the reading that R13 had
-- reintroduced word-choice gating. That reading was wrong, and this reverts it.
--
-- The client guard has rejected those two shapes since 2026-06-15 (920c46a1,
-- ENTIRE_ORDER_DISCOUNT_PATTERNS / SECOND_ITEM_DISCOUNT_PATTERNS) and does so
-- DELIBERATELY ahead of its own structured accept -- lib/strong-deal-guard.ts
-- carries a comment saying so, and lib/strong-deal-guard.test.ts has a case
-- named "does not let the structured offer rescue a weak or disqualified deal"
-- asserting that "50% off your entire order" with a structured 50% offer is
-- still rejected. Entire-order and second-item discounts are disqualified
-- SHAPES for Twofer, not merely weak percentages.
--
-- So 20260820160000 did not unblock any merchant: app/create/ai.tsx runs the
-- client guard before it ever calls publish-offer-version, so those titles were
-- still blocked there. All it did was leave the SQL guard -- the last line of
-- defence, and the only one that applies to a client we do not control -- more
-- permissive than the product rule. This closes that gap.
--
-- The narrow false positive that prompted the change is real but is NOT fixed
-- here: "40% off all drinks today" on a SINGLE_ITEM 40% deal is rejected
-- because the regex matches the COPY while the structured facts say
-- SINGLE_ITEM. The right fix keys these rules off the structured applies_to
-- column (already constrained to SINGLE_ITEM / ENTIRE_ORDER / SECOND_ITEM by
-- deals_applies_to_check), using prose only when applies_to is absent, and it
-- has to land in the client and the SQL twin together. Tracked separately.
--
-- Body below is R13's, restored verbatim.
--
-- SIGNATURE NOTE: the argument list is byte-for-byte R13's. CREATE OR REPLACE
-- FUNCTION cannot change an argument list -- if it differs at all, Postgres
-- creates a SECOND OVERLOAD rather than replacing, which is how R13 left two
-- copies of this function in production and made every 2-argument call
-- ambiguous (PGRST203). Verify before applying.

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
     OR v_text ~* '[0-9]{1,3}\s*%\s*off\s+(everything|all\s+(drinks|items|pastries|orders|food))'
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

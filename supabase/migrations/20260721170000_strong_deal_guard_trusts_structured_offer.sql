-- R13: a valid deal could be BLOCKED FROM PUBLISHING by the AI's choice of synonym.
--
-- `is_strong_deal_offer` only ever looked at the title and description, so a genuine
-- 40%-off offer was rejected when the generated copy happened to say "for 40% less" or
-- "save 40%" instead of the literal "40% off". Observed live during the poster-quality
-- harness (session 3, journey J5): the offer was valid, the merchant had entered it
-- correctly, and the error told them to fix an offer that was never wrong. Whether
-- publishing succeeded came down to which phrasing the model drew.
--
-- The facts were always available and simply were not consulted: this is a row trigger on
-- public.deals, so NEW already carries deal_type, discount_percent, free_item_quantity and
-- free_item_discount_percent — the merchant's own structured, already-validated offer.
--
-- This mirrors lib/strong-deal-guard.ts (structuredOfferIsStrong + validateStrongDealOnly).
-- Keep the two in sync; scripts/probe-strong-deal.mjs checks parity against prod.
--
-- Priority order is UNCHANGED except for one added acceptance:
--   1. SECOND-ITEM / ENTIRE-ORDER shapes -> REJECT   (prose, unchanged)
--   2. FREE ITEM (prose) OR STRUCTURED-STRONG -> PASS  <-- structured accept added here
--   3. CONDITIONAL DISCOUNT -> REJECT                (prose, unchanged)
--   4. PERCENT FLOOR (<40)  -> REJECT                (unchanged)
--   5. STRONG LANGUAGE      -> PASS, else REJECT     (prose, unchanged)
--
-- The structured accept sits at step 2 deliberately, BELOW the shape rejections, so it can
-- only turn a REJECT into a PASS for offers whose own facts already qualify. No offer that
-- publishes today starts failing. Note the one intended consequence: a stray low percentage
-- in the prose ("10% off refills") no longer vetoes a deal the contract says is 40%+, which
-- is precisely the false rejection this fixes.

-- Structured-only decision. NULL = "no usable structured facts, fall through to prose".
CREATE OR REPLACE FUNCTION public.structured_offer_is_strong(
  p_deal_type TEXT,
  p_discount_percent NUMERIC,
  p_free_item_quantity NUMERIC,
  p_free_item_discount_percent NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_deal_type TEXT := upper(btrim(coalesce(p_deal_type, '')));
BEGIN
  IF v_deal_type IN ('BUY_ONE_GET_ONE_FREE', 'BUY_ONE_GET_SOMETHING_FREE') THEN
    RETURN TRUE;
  END IF;

  IF p_free_item_quantity IS NOT NULL
     AND p_free_item_quantity >= 1
     AND (p_free_item_discount_percent IS NULL OR p_free_item_discount_percent >= 100)
  THEN
    RETURN TRUE;
  END IF;

  IF p_discount_percent IS NOT NULL THEN
    RETURN p_discount_percent >= 39.5;
  END IF;

  RETURN NULL;
END;
$$;

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

-- Pass the row's own structured facts to the guard. This is the whole fix: the trigger
-- always had them on NEW and never used them.
CREATE OR REPLACE FUNCTION public.enforce_strong_deal_only_guardrail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_strong_deal_offer(
       NEW.title,
       NEW.description,
       NEW.deal_type,
       NEW.discount_percent,
       NEW.free_item_quantity,
       NEW.free_item_discount_percent
     ) THEN
    RAISE EXCEPTION
      'Every Twofer deal must be at least 40%% off or give something free — '
      'e.g. ''Buy a coffee, get a muffin free'' or ''2-for-1 lattes''. '
      'Conditional deals like ''buy X + 40%% off Y'' don''t qualify.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_strong_deal_only_guardrail ON public.deals;
CREATE TRIGGER trg_enforce_strong_deal_only_guardrail
BEFORE INSERT OR UPDATE OF title, description ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_strong_deal_only_guardrail();

-- The quality-tier trigger calls the 2-arg form, which still resolves via the DEFAULTs and
-- keeps its prose-only behaviour. Left alone deliberately: quality_tier is a label, not a
-- gate, and changing how it is derived is a separate decision from unblocking publishes.

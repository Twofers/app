-- Align the server strong-deal guardrail with the client mirror in
-- lib/strong-deal-guard.ts. The previous SQL was STRICTER than the client for
-- several legitimate strong-deal phrasings, so the client let owners hit Publish
-- but the row trigger then RAISEd — surfacing only a generic "Publish failed".
--
-- Confirmed divergences (client PASS / old server REJECT), verified read-only
-- against prod via scripts/probe-strong-deal.mjs:
--   * free item with trailing punctuation — "...second pastry is free!"
--     (old `LIKE '% free %'` required a space on BOTH sides)
--   * Spanish / Korean free + BOGO language ("gratis", "2x1", Korean tokens, ...)
--   * "get one free", "1+1"
--
-- This keeps the guardrail's INTENT intact (weak deals are still rejected); it
-- only stops valid strong deals from being wrongly blocked. Priority order
-- matches the client exactly:
--   1. FREE ITEM            -> PASS
--   2. CONDITIONAL DISCOUNT -> REJECT  ("buy X + N% off Y", reward not free)
--   3. PERCENT FLOOR (<40)  -> REJECT
--   4. STRONG LANGUAGE      -> PASS
--   5. otherwise            -> REJECT

CREATE OR REPLACE FUNCTION public.is_strong_deal_offer(
  p_title TEXT,
  p_description TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_text TEXT;
  v_match TEXT;
BEGIN
  v_text := lower(coalesce(p_title, '') || ' ' || coalesce(p_description, ''));

  -- 1. FREE ITEM ------------------------------------------------------------
  -- "free" preceded by whitespace/start and ended by a word boundary, so
  -- "free!", "free." and "free," all match while "sugar-free" / "caffeine-free"
  -- (hyphen before) and "freedom" (no boundary after) do not.
  IF v_text ~* '(^|\s)free\y'
     OR v_text ~* '\mon\s+the\s+house\M'
     OR v_text ~* '\mcomplimentary\M'
     -- Spanish (containment for accented/short tokens — no real superstrings)
     OR v_text ~* '\mgratis\M'
     OR v_text ~* 'cortesía'
     OR v_text ~* 'de\s+regalo'
     OR v_text ~* 'invita\s+la\s+casa'
     -- Korean (client uses bare containment — no word boundaries)
     OR v_text ~ '무료'        -- free
     OR v_text ~ '서비스'      -- service / on the house
     OR v_text ~ '공짜'        -- free
  THEN
    RETURN TRUE;
  END IF;

  -- 2. CONDITIONAL DISCOUNT -------------------------------------------------
  -- "buy X + N% off Y" — discount requires buying a different item, reward not
  -- free → reject (mirrors the client's "+" notation rule).
  IF v_text ~* 'buy\s+\S.{0,60}\s*\+\s*[0-9]{1,3}\s*%\s*off' THEN
    RETURN FALSE;
  END IF;

  -- 3. PERCENT FLOOR --------------------------------------------------------
  FOR v_match IN
    SELECT m[1] FROM regexp_matches(v_text, '([0-9]{1,3})\s*%', 'g') AS m
  LOOP
    IF v_match::INT < 40 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  -- 4. STRONG LANGUAGE ------------------------------------------------------
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
    -- Spanish strong language
    OR v_text ~* 'compra\s+uno?\M.*gratis'
    OR v_text ~* 'lleva(te)?\s+(otro|el\s+segundo).*gratis'
    OR v_text ~* '2\s*(x|por)\s*1'
    OR v_text ~* 'dos\s+por\s+uno'
    OR v_text ~* '[4-9][0-9]\s*%\s*(de\s+)?descuento'
    OR v_text ~* 'mitad\s+de\s+precio'
    OR v_text ~* 'el\s+segundo\s+a\s+mitad'
    -- Korean strong language
    OR v_text ~ '1\s*\+\s*1'              -- 1+1
    OR v_text ~ '[4-9][0-9]\s*%\s*할인'   -- NN% 할인 (discount)
    OR v_text ~ '하나\s*사면\s*하나'      -- buy one get one
    OR v_text ~ '반값'                    -- half price
  THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Trigger function/attachment unchanged — re-create idempotently so the new
-- definition is picked up and the friendly message stays in place.
CREATE OR REPLACE FUNCTION public.enforce_strong_deal_only_guardrail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_strong_deal_offer(NEW.title, NEW.description) THEN
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

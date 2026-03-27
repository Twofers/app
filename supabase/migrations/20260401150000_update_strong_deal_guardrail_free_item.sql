-- Update strong-deal guardrail to mirror the TypeScript logic in strong-deal-guard.ts
-- Priority order:
--   1. FREE ITEM  — "free" (not hyphenated), "on the house", "complimentary" → PASS
--   2. CONDITIONAL DISCOUNT — "buy X + N% off Y" without a free item → REJECT
--   3. PERCENT FLOOR — any explicit % < 40 → REJECT
--   4. STRONG LANGUAGE — BOGO / 2-for-1 / 40%+ → PASS
--   5. Otherwise → REJECT

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

  -- 1. FREE ITEM — "free" preceded by whitespace (not "sugar-free" / "dairy-free")
  --    Also catch "on the house" and "complimentary".
  IF v_text LIKE '% free %'
     OR v_text LIKE '% free'
     OR v_text LIKE 'free %'
     OR v_text = 'free'
     OR v_text ~* '\mon\s+the\s+house\M'
     OR v_text ~* '\mcomplimentary\M'
  THEN
    RETURN TRUE;
  END IF;

  -- 2. CONDITIONAL DISCOUNT — "buy X + N% off Y" style.
  --    Discount requires purchasing a different item and is not 100% off → reject.
  IF v_text ~* 'buy\s+\S.{0,60}\s*\+\s*[0-9]{1,3}\s*%\s*off' THEN
    RETURN FALSE;
  END IF;

  -- 3. PERCENT FLOOR — any explicit percentage below 40 → reject.
  FOR v_match IN
    SELECT m[1]
    FROM regexp_matches(v_text, '([0-9]{1,3})\s*%', 'g') AS m
  LOOP
    IF v_match::INT < 40 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  -- 4. STRONG LANGUAGE — explicit BOGO / 2-for-1 / 40%+ off.
  IF v_text ~* '\mbogo\M'
    OR v_text ~* '2\s*[- ]?\s*for\s*[- ]?\s*1'
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

-- Update trigger function with the new, friendlier error message.
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

-- Re-attach trigger (idempotent — drops first if it already exists).
DROP TRIGGER IF EXISTS trg_enforce_strong_deal_only_guardrail ON public.deals;
CREATE TRIGGER trg_enforce_strong_deal_only_guardrail
BEFORE INSERT OR UPDATE OF title, description ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_strong_deal_only_guardrail();

-- Human-readable code for manual / visual verification at redeem (QR still uses full token).
ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS short_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS deal_claims_short_code_key
  ON public.deal_claims (short_code)
  WHERE short_code IS NOT NULL;

COMMENT ON COLUMN public.deal_claims.short_code IS '6-char code for staff manual redeem; nullable on legacy rows';

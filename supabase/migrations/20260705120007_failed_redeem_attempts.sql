-- Track failed redemption attempts (wrong/unknown short codes) to prevent brute-force
-- harvesting of valid codes by malicious merchants.
--
-- The redeem-token edge function will:
--   1. Insert a row here on every redemption attempt with `success = false`.
--   2. Before processing each attempt, count rows with success=false in the last 5 minutes
--      keyed on (business_id, ip_address). If >= 10, lock out with a 429.

CREATE TABLE IF NOT EXISTS public.failed_redeem_attempts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ip_address    inet,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  reason        text        NOT NULL  -- 'unknown_code', 'expired', 'wrong_business', etc.
);

CREATE INDEX IF NOT EXISTS idx_failed_redeem_attempts_lookup
  ON public.failed_redeem_attempts (business_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_failed_redeem_attempts_ip_lookup
  ON public.failed_redeem_attempts (business_id, ip_address, attempted_at DESC)
  WHERE ip_address IS NOT NULL;

ALTER TABLE public.failed_redeem_attempts ENABLE ROW LEVEL SECURITY;

-- Service role only — clients must never read or write this table directly.
-- (No policies = locked down by RLS default-deny.)

COMMENT ON TABLE public.failed_redeem_attempts
  IS 'Append-only log of failed token/code redemption attempts. Used by redeem-token to enforce per-business per-IP rate limiting.';

-- PROPOSED — NOT APPLIED, NOT IN THE LIVE MIGRATIONS SEQUENCE.
--
-- This is the optional "full" fix for audit finding M2 (docs/qa/BRANCH_SECURITY_CODE_AUDIT_2026-07-13.md):
-- it makes the public-intake rate-limit check-and-record ATOMIC, closing the
-- residual check-then-act (TOCTOU) gap that the in-code reorder only narrowed.
--
-- Applying a migration is HARD-GATED (needs Dan's approval). To adopt this:
--   1. Copy this file to supabase/migrations/<timestamp>_submission_rate_limit.sql
--   2. Apply it (supabase db push) with approval.
--   3. Wire submit-business-application + submit-launch-signup to the RPC (snippet
--      at the bottom), replacing their count-based isRateLimited().
--   4. Run: node scripts/probe-rls-smoke.mjs  (RLS-touching migration).
-- Do NOT deploy the wired function until the migration is live in that project,
-- or the RPC call will 404.

BEGIN;

-- Append-only ledger of accepted public submissions, used only to enforce rate
-- limits. RLS-closed: only service_role (Edge Functions) ever touches it.
CREATE TABLE IF NOT EXISTS public.submission_rate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL,             -- 'business_application' | 'launch_signup'
  email_key text,
  ip_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.submission_rate_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.submission_rate_events FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_submission_rate_events_email
  ON public.submission_rate_events (bucket, email_key, created_at DESC)
  WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_submission_rate_events_ip
  ON public.submission_rate_events (bucket, ip_key, created_at DESC)
  WHERE ip_key IS NOT NULL;

-- Atomically decide whether a submission is within its per-email and per-IP caps
-- and, if so, record it — all under transaction-scoped advisory locks so a burst
-- of concurrent requests sharing an identifier cannot all pass the check before
-- any of them records its attempt. Returns true = allowed, false = rate limited.
CREATE OR REPLACE FUNCTION public.claim_submission_slot(
  p_bucket text,
  p_email_key text,
  p_ip_key text,
  p_window_minutes int,
  p_max_email int,
  p_max_ip int
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz := now() - make_interval(mins => greatest(p_window_minutes, 1));
  v_count int;
BEGIN
  -- Serialize concurrent submissions that share an identifier. Advisory locks are
  -- released automatically at COMMIT, so the count→insert below is atomic per key.
  IF p_email_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_bucket || ':email:' || p_email_key, 0));
  END IF;
  IF p_ip_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_bucket || ':ip:' || p_ip_key, 0));
  END IF;

  IF p_email_key IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.submission_rate_events
      WHERE bucket = p_bucket AND email_key = p_email_key AND created_at >= v_window_start;
    IF v_count >= p_max_email THEN RETURN false; END IF;
  END IF;

  IF p_ip_key IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.submission_rate_events
      WHERE bucket = p_bucket AND ip_key = p_ip_key AND created_at >= v_window_start;
    IF v_count >= p_max_ip THEN RETURN false; END IF;
  END IF;

  INSERT INTO public.submission_rate_events (bucket, email_key, ip_key)
    VALUES (p_bucket, p_email_key, p_ip_key);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_submission_slot(text, text, text, int, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_submission_slot(text, text, text, int, int, int) TO service_role;

COMMIT;

-- ── Edge Function wiring (after the migration is live) ───────────────────────
-- Replace the count-based isRateLimited() call with the atomic RPC:
--
--   const { data: allowed, error } = await supabase.rpc("claim_submission_slot", {
--     p_bucket: "business_application",
--     p_email_key: email,
--     p_ip_key: requestIp,
--     p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
--     p_max_email: RATE_LIMIT_MAX_PER_EMAIL,
--     p_max_ip: RATE_LIMIT_MAX_PER_IP,
--   });
--   if (error) throw error;
--   if (!allowed) return json(req, { error: "Too many requests. Please try again later." }, 429);
--
-- The in-code client-independent flood ceiling (alertFloodExceeded / suppress the
-- admin alert + quick-approval mint) stays as-is; it is complementary to this
-- per-actor atomic claim. A periodic cleanup (delete rows older than the window)
-- keeps submission_rate_events small.

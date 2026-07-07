-- No-card trial capability for self-serve Stripe checkout (Dan, 2026-07-06):
-- early sign-ups should be able to start a trial with no credit card; Dan
-- wants a global on/off switch he can flip later (once he wants everyone
-- card-gated again), plus a demo/exemption code that always waives the card
-- requirement regardless of the switch (a manual override for VIPs/support).
--
-- Also folds in Finding 05 (trial-reuse guard): the automatic (code-less)
-- no-card path must respect the existing per-physical-location trial-reuse
-- infrastructure (business_location_identity / check_business_location_trial_
-- reuse), the same signal the admin no-card trial RPC already uses. A valid
-- exemption code is a manual override and bypasses the reuse guard on
-- purpose, mirroring admin_grant_location_trial's own p_override_trial_reuse.

BEGIN;

ALTER TABLE public.app_runtime_config
  ADD COLUMN IF NOT EXISTS require_card_for_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_card_trial_days integer NOT NULL DEFAULT 30
    CHECK (no_card_trial_days > 0);

COMMENT ON COLUMN public.app_runtime_config.require_card_for_trial IS
  'false = self-serve Stripe checkout may start a trial with payment_method_collection "if_required" (no card). true = always "always" (card required). Dan flips this directly; defaults false for the initial no-card launch cohort.';
COMMENT ON COLUMN public.app_runtime_config.no_card_trial_days IS
  'Stripe subscription_data.trial_period_days granted when a checkout skips card collection, so $0 is due today and Stripe does not ask for a card under "if_required".';

CREATE TABLE IF NOT EXISTS public.trial_no_card_exemption_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  label text,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_no_card_exemption_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_no_card_exemption_codes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.trial_no_card_exemption_codes TO service_role;

COMMENT ON TABLE public.trial_no_card_exemption_codes IS
  'Hashed demo/exemption codes that waive the card requirement (and the trial-reuse guard) at self-serve Stripe checkout, regardless of app_runtime_config.require_card_for_trial. Service-role only -- checked/consumed by stripe-create-checkout-session.';

-- Atomic check-and-increment so a shared/popular code can't be raced past
-- max_uses by concurrent checkouts. Always returns a concrete boolean (a bare
-- `UPDATE ... RETURNING true` would return NULL, not false, when no row
-- matches), so callers can safely test `data === true`.
CREATE OR REPLACE FUNCTION public.consume_trial_no_card_exemption_code(
  p_code_hash text,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.trial_no_card_exemption_codes
  SET use_count = use_count + 1
  WHERE code_hash = p_code_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > p_now)
    AND use_count < max_uses;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_trial_no_card_exemption_code(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_trial_no_card_exemption_code(text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.consume_trial_no_card_exemption_code(text, timestamptz) IS
  'Atomically validates and consumes one use of a trial_no_card_exemption_codes row. Returns true (one row) if consumed, no rows if invalid/expired/revoked/exhausted.';

COMMIT;

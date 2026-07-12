-- Atomic billing-token consumption (audit F-006).
--
-- stripe-create-checkout-session and stripe-customer-portal-session previously
-- SELECTed use_count, checked the limit in JS, then UPDATEd in a second
-- statement. Two concurrent replays of the same single-use token could both
-- pass the check and each create a Stripe session. Consume in ONE conditional
-- UPDATE instead, so exactly one concurrent caller can win each remaining use.
--
-- Mirrors consume_trial_no_card_exemption_code
-- (20260804123000_trial_no_card_toggle_and_exemption_codes.sql): plpgsql +
-- GET DIAGNOSTICS so the function always returns a concrete boolean (a bare
-- `UPDATE ... RETURNING true` yields NULL, not false, when no row matches).

BEGIN;

CREATE OR REPLACE FUNCTION public.consume_billing_token(
  p_business_id uuid,
  p_token_hash text,
  p_action text,
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
  -- Matches the billing_tokens.action CHECK constraint (20260730127000).
  IF p_action NOT IN ('subscription_checkout', 'setup_payment_method', 'customer_portal') THEN
    RETURN false;
  END IF;

  UPDATE public.billing_tokens
  SET use_count = use_count + 1
  WHERE business_id = p_business_id
    AND token_hash = p_token_hash
    AND action = p_action
    AND revoked_at IS NULL
    AND expires_at > p_now
    AND use_count < max_uses;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- Supabase default privileges grant EXECUTE to anon/authenticated on new
-- functions, and REVOKE FROM PUBLIC alone does not remove those explicit
-- grants (verified live 2026-06-10). Revoke each role explicitly.
REVOKE ALL ON FUNCTION public.consume_billing_token(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_billing_token(uuid, text, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.consume_billing_token(uuid, text, text, timestamptz) IS
  'Atomically validates and consumes one use of a billing_tokens row (business + hash + action must match; not revoked/expired/exhausted). Returns true iff exactly this call consumed a use. Service-role only -- called by stripe-create-checkout-session and stripe-customer-portal-session.';

COMMIT;

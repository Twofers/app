-- Atomic business-claim-link use consumption (web-attack review 2026-07-31, M-4).
--
-- business-claim-link previously SELECTed uses_count, checked uses_count <
-- max_uses in JS, did a chunk of work, then UPDATEd uses_count in a separate
-- statement at the end. Two concurrent POSTs on the same single-use token could
-- both pass the JS check and each create a business_applications row (and an
-- approval email / onboarding record). Consume in ONE conditional UPDATE so
-- exactly one concurrent caller can win each remaining use.
--
-- Mirrors consume_billing_token (20260813120000): plpgsql + GET DIAGNOSTICS so
-- the function always returns a concrete boolean (a bare `UPDATE ... RETURNING
-- true` yields NULL, not false, when no row matches).

BEGIN;

CREATE OR REPLACE FUNCTION public.consume_business_claim_link_use(
  p_token_hash text,
  p_accepted_by_user_id uuid DEFAULT NULL,
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
  UPDATE public.business_claim_links
  SET uses_count = uses_count + 1,
      accepted_by_user_id = COALESCE(p_accepted_by_user_id, accepted_by_user_id),
      accepted_at = p_now
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND expires_at > p_now
    AND uses_count < max_uses;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- Supabase default privileges grant EXECUTE to anon/authenticated on new
-- functions, and REVOKE FROM PUBLIC alone does not remove those explicit grants
-- (verified live 2026-06-10). Revoke each role explicitly.
REVOKE ALL ON FUNCTION public.consume_business_claim_link_use(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_business_claim_link_use(text, uuid, timestamptz) TO service_role;

COMMENT ON FUNCTION public.consume_business_claim_link_use(text, uuid, timestamptz) IS
  'Atomically consumes one use of a business_claim_links row (token hash must match; not revoked/expired/exhausted). Returns true iff exactly this call consumed a use. Service-role only -- called by business-claim-link to close the uses_count TOCTOU (web-attack review 2026-07-31, M-4).';

COMMIT;

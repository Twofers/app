-- Full-access approvals are an explicit admin trust decision. When the owner
-- later creates the account with the exact approved email, treat that email as
-- confirmed so the owner does not receive a redundant confirmation link.
--
-- Approved-for-setup accounts also get one server-controlled AI ad generation
-- as a demo. They remain unable to publish until Stripe activates access.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_full_access_business_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.email IS NOT NULL
    AND NEW.email_confirmed_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.business_applications ba
      WHERE lower(btrim(COALESCE(ba.approved_email_normalized, ba.email))) = lower(btrim(NEW.email))
        AND ba.full_access_granted_at IS NOT NULL
        AND ba.full_access_trial_days IS NOT NULL
        AND ba.full_access_granted_at + make_interval(days => ba.full_access_trial_days) > now()
    )
  THEN
    NEW.email_confirmed_at := now();
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NEW.email_confirmed_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS confirm_full_access_business_signup ON auth.users;
CREATE TRIGGER confirm_full_access_business_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.confirm_full_access_business_signup();

REVOKE ALL ON FUNCTION public.confirm_full_access_business_signup() FROM PUBLIC;

-- Also cover the reverse ordering: if the owner created an unconfirmed account
-- before the admin grant was applied, the grant confirms that existing account.
CREATE OR REPLACE FUNCTION public.confirm_full_access_business_users(p_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_confirmed integer;
BEGIN
  UPDATE auth.users u
  SET email_confirmed_at = COALESCE(u.email_confirmed_at, now()),
      confirmed_at = COALESCE(u.confirmed_at, u.email_confirmed_at, now())
  WHERE u.email_confirmed_at IS NULL
    AND lower(btrim(COALESCE(u.email, ''))) = lower(btrim(COALESCE(p_email, '')))
    AND EXISTS (
      SELECT 1
      FROM public.business_applications ba
      WHERE lower(btrim(COALESCE(ba.approved_email_normalized, ba.email))) = lower(btrim(COALESCE(p_email, '')))
        AND ba.full_access_granted_at IS NOT NULL
        AND ba.full_access_trial_days IS NOT NULL
        AND ba.full_access_granted_at + make_interval(days => ba.full_access_trial_days) > now()
    );
  GET DIAGNOSTICS v_confirmed = ROW_COUNT;
  RETURN v_confirmed;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_full_access_business_users(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_full_access_business_users(text) TO service_role;

ALTER TABLE public.business_setup_ai_allowances
  ADD COLUMN IF NOT EXISTS demo_ad_generations_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demo_ad_generations_limit integer NOT NULL DEFAULT 1;

ALTER TABLE public.business_setup_ai_allowances
  DROP CONSTRAINT IF EXISTS business_setup_ai_allowances_demo_ad_generations_check,
  ADD CONSTRAINT business_setup_ai_allowances_demo_ad_generations_check
    CHECK (demo_ad_generations_used >= 0 AND demo_ad_generations_limit >= 0);

-- Keep the existing evaluator as the canonical source for active/publish
-- decisions, then expose a narrow demo-only AI capability on top of it.
ALTER FUNCTION public.get_business_capabilities(uuid)
  RENAME TO get_business_capabilities_base;

CREATE OR REPLACE FUNCTION public.get_business_capabilities(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_base jsonb;
  v_remaining integer;
BEGIN
  v_base := public.get_business_capabilities_base(p_business_id);

  SELECT GREATEST(0, allowance.demo_ad_generations_limit - allowance.demo_ad_generations_used)
    INTO v_remaining
  FROM public.business_setup_ai_allowances allowance
  WHERE allowance.business_id = p_business_id;

  v_remaining := COALESCE(
    v_remaining,
    CASE WHEN v_base ->> 'reason_code' = 'approved_not_activated' THEN 1 ELSE 0 END
  );

  IF v_base ->> 'reason_code' = 'approved_not_activated' AND v_remaining > 0 THEN
    RETURN v_base || jsonb_build_object(
      'reason_code', 'demo',
      'access_mode', 'demo',
      'demo_ad_generations_remaining', v_remaining,
      'can_generate_ai', true,
      'can_consume_offer_credits', true,
      'can_publish_offer', false,
      'can_receive_new_claims', false
    );
  END IF;

  RETURN v_base || jsonb_build_object('demo_ad_generations_remaining', v_remaining);
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_capabilities(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_demo_ai_generation(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_allowance public.business_setup_ai_allowances%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('demo_ai_generation:' || p_business_id::text));
  INSERT INTO public.business_setup_ai_allowances (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  SELECT * INTO v_allowance
  FROM public.business_setup_ai_allowances
  WHERE business_id = p_business_id
  FOR UPDATE;

  IF v_allowance.demo_ad_generations_used >= v_allowance.demo_ad_generations_limit THEN
    RETURN false;
  END IF;

  UPDATE public.business_setup_ai_allowances
    SET demo_ad_generations_used = demo_ad_generations_used + 1,
        updated_at = now()
  WHERE business_id = p_business_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_demo_ai_generation(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('demo_ai_generation:' || p_business_id::text));
  UPDATE public.business_setup_ai_allowances
    SET demo_ad_generations_used = GREATEST(0, demo_ad_generations_used - 1),
        updated_at = now()
  WHERE business_id = p_business_id
    AND demo_ad_generations_used > 0;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_demo_ai_generation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_demo_ai_generation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_demo_ai_generation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_demo_ai_generation(uuid) TO service_role;

COMMIT;

-- Pilot-stage gate against random users signing up as a business and listing a
-- cafe they don't own. Only users who've validated the shared pilot invite code
-- (see lib/business-invite.ts) can create rows in `businesses`. Existing pilot
-- accounts are backfilled so they aren't locked out of editing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_invite_validations (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  validated_at timestamptz NOT NULL DEFAULT now(),
  code_used text NOT NULL
);

ALTER TABLE public.business_invite_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_invite_self_read ON public.business_invite_validations;
CREATE POLICY business_invite_self_read
  ON public.business_invite_validations FOR SELECT
  USING (auth.uid() = user_id);

-- No client-side INSERT/UPDATE/DELETE policies — writes happen only through
-- public.validate_business_invite (SECURITY DEFINER below).

CREATE OR REPLACE FUNCTION public.validate_business_invite(invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  normalized text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  normalized := lower(trim(coalesce(invite_code, '')));
  IF normalized <> 'penguin' THEN
    RAISE EXCEPTION 'invalid invite code' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.business_invite_validations(user_id, validated_at, code_used)
  VALUES (uid, now(), normalized)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_business_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_business_invite(text) TO authenticated;

-- Backfill: every existing business owner is treated as already validated so
-- pilot cafes that signed up before this migration aren't blocked from editing.
INSERT INTO public.business_invite_validations(user_id, validated_at, code_used)
SELECT DISTINCT owner_id, now(), 'pilot_backfill'
FROM public.businesses
WHERE owner_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.businesses_require_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_invite_validations
    WHERE user_id = COALESCE(NEW.owner_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'business invite required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS businesses_require_invite_trg ON public.businesses;
CREATE TRIGGER businesses_require_invite_trg
  BEFORE INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.businesses_require_invite();

COMMIT;

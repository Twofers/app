-- Server-owned physical-location identity checks for self-serve trial abuse control.

CREATE TABLE IF NOT EXISTS public.business_duplicate_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  matched_business_location_id uuid NULL REFERENCES public.business_locations(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('google_place_id', 'address_phone', 'address_business_name')),
  review_status text NOT NULL DEFAULT 'open'
    CHECK (review_status IN ('open', 'approved', 'rejected', 'ignored')),
  risk_score numeric NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_location_id, matched_business_location_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_business_duplicate_review_queue_status
  ON public.business_duplicate_review_queue (review_status, created_at DESC);

ALTER TABLE public.business_duplicate_review_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.normalize_business_identity_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        regexp_replace(lower(COALESCE(p_value, '')), '[^a-z0-9]+', ' ', 'g'),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_business_identity_phone(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text;
BEGIN
  v_digits := regexp_replace(COALESCE(p_value, ''), '[^0-9]+', '', 'g');
  IF char_length(v_digits) = 11 AND left(v_digits, 1) = '1' THEN
    v_digits := substr(v_digits, 2);
  END IF;
  RETURN NULLIF(v_digits, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_business_identity_domain(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_domain text;
BEGIN
  v_domain := lower(btrim(COALESCE(p_value, '')));
  v_domain := regexp_replace(v_domain, '^mailto:', '');
  IF position('@' in v_domain) > 0 AND v_domain !~ '^https?://' THEN
    v_domain := split_part(v_domain, '@', 2);
  END IF;
  v_domain := regexp_replace(v_domain, '^https?://', '');
  v_domain := regexp_replace(v_domain, '^www\.', '');
  v_domain := split_part(v_domain, '/', 1);
  v_domain := split_part(v_domain, '?', 1);
  v_domain := split_part(v_domain, '#', 1);
  v_domain := split_part(v_domain, ':', 1);
  RETURN NULLIF(v_domain, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_business_location_identity(
  p_business_location_id uuid
)
RETURNS public.business_location_identity
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_identity public.business_location_identity%ROWTYPE;
BEGIN
  INSERT INTO public.business_location_identity (
    business_location_id,
    normalized_business_name,
    normalized_address,
    normalized_phone,
    business_email_domain,
    updated_at
  )
  SELECT
    bl.id,
    public.normalize_business_identity_text(COALESCE(NULLIF(bl.name, ''), b.name, bp.name)),
    public.normalize_business_identity_text(COALESCE(NULLIF(bl.address, ''), b.address, bp.address)),
    public.normalize_business_identity_phone(COALESCE(NULLIF(bl.phone, ''), b.phone)),
    public.normalize_business_identity_domain(b.business_email),
    now()
  FROM public.business_locations bl
  LEFT JOIN public.businesses b
    ON b.id = bl.business_id
  LEFT JOIN public.business_profiles bp
    ON bp.id = bl.business_id
  WHERE bl.id = p_business_location_id
  ON CONFLICT (business_location_id)
  DO UPDATE SET
    normalized_business_name = EXCLUDED.normalized_business_name,
    normalized_address = EXCLUDED.normalized_address,
    normalized_phone = EXCLUDED.normalized_phone,
    business_email_domain = EXCLUDED.business_email_domain,
    updated_at = now()
  RETURNING * INTO v_identity;

  IF v_identity.id IS NULL THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_identity;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_business_location_trial_reuse(
  p_business_location_id uuid
)
RETURNS TABLE(decision text, matched_business_location_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_identity public.business_location_identity%ROWTYPE;
  v_match public.business_location_identity%ROWTYPE;
BEGIN
  v_identity := public.refresh_business_location_identity(p_business_location_id);

  IF v_identity.google_place_id IS NOT NULL THEN
    SELECT *
      INTO v_match
    FROM public.business_location_identity
    WHERE business_location_id <> p_business_location_id
      AND google_place_id = v_identity.google_place_id
      AND trial_used_at IS NOT NULL
    ORDER BY trial_used_at DESC
    LIMIT 1;

    IF v_match.id IS NOT NULL THEN
      INSERT INTO public.business_duplicate_review_queue (
        business_location_id,
        matched_business_location_id,
        reason,
        risk_score,
        evidence
      )
      VALUES (
        p_business_location_id,
        v_match.business_location_id,
        'google_place_id',
        100,
        jsonb_build_object('google_place_id', v_identity.google_place_id)
      )
      ON CONFLICT (business_location_id, matched_business_location_id, reason)
      DO UPDATE SET updated_at = now();

      RETURN QUERY SELECT 'block'::text, v_match.business_location_id, 'google_place_id'::text;
      RETURN;
    END IF;
  END IF;

  IF v_identity.normalized_address IS NOT NULL AND v_identity.normalized_phone IS NOT NULL THEN
    SELECT *
      INTO v_match
    FROM public.business_location_identity
    WHERE business_location_id <> p_business_location_id
      AND normalized_address = v_identity.normalized_address
      AND normalized_phone = v_identity.normalized_phone
      AND trial_used_at IS NOT NULL
    ORDER BY trial_used_at DESC
    LIMIT 1;

    IF v_match.id IS NOT NULL THEN
      INSERT INTO public.business_duplicate_review_queue (
        business_location_id,
        matched_business_location_id,
        reason,
        risk_score,
        evidence
      )
      VALUES (
        p_business_location_id,
        v_match.business_location_id,
        'address_phone',
        90,
        jsonb_build_object(
          'normalized_address', v_identity.normalized_address,
          'normalized_phone', v_identity.normalized_phone
        )
      )
      ON CONFLICT (business_location_id, matched_business_location_id, reason)
      DO UPDATE SET updated_at = now();

      RETURN QUERY SELECT 'block'::text, v_match.business_location_id, 'address_phone'::text;
      RETURN;
    END IF;
  END IF;

  IF v_identity.normalized_address IS NOT NULL AND v_identity.normalized_business_name IS NOT NULL THEN
    SELECT *
      INTO v_match
    FROM public.business_location_identity
    WHERE business_location_id <> p_business_location_id
      AND normalized_address = v_identity.normalized_address
      AND normalized_business_name = v_identity.normalized_business_name
      AND trial_used_at IS NOT NULL
    ORDER BY trial_used_at DESC
    LIMIT 1;

    IF v_match.id IS NOT NULL THEN
      INSERT INTO public.business_duplicate_review_queue (
        business_location_id,
        matched_business_location_id,
        reason,
        risk_score,
        evidence
      )
      VALUES (
        p_business_location_id,
        v_match.business_location_id,
        'address_business_name',
        70,
        jsonb_build_object(
          'normalized_address', v_identity.normalized_address,
          'normalized_business_name', v_identity.normalized_business_name
        )
      )
      ON CONFLICT (business_location_id, matched_business_location_id, reason)
      DO UPDATE SET updated_at = now();

      RETURN QUERY SELECT 'review'::text, v_match.business_location_id, 'address_business_name'::text;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT 'allow'::text, NULL::uuid, NULL::text;
END;
$$;

REVOKE ALL ON TABLE public.business_duplicate_review_queue FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_duplicate_review_queue TO service_role;

REVOKE ALL ON FUNCTION public.normalize_business_identity_text(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_business_identity_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_business_identity_domain(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_business_location_identity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_business_location_trial_reuse(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.refresh_business_location_identity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_business_location_trial_reuse(uuid) TO service_role;

COMMENT ON TABLE public.business_duplicate_review_queue IS
  'Server-owned review queue for likely duplicate physical business locations before trial activation.';

COMMENT ON FUNCTION public.check_business_location_trial_reuse(uuid) IS
  'Normalizes location identity, blocks clear prior-trial matches, and queues softer duplicate signals for admin review.';

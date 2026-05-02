-- Reports for the pilot trust loop:
--   business_reports — a customer can flag a business for not honoring a deal.
--   user_reports     — a business can flag a customer (e.g. abusive, fraud).
-- Both write through SECURITY DEFINER RPCs so RLS stays simple (no client-side
-- writes) and so user_reports can resolve the customer's user_id from a
-- redeemable claim without leaking that id back to the caller.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('not_honored','doesnt_exist','wrong_info','inappropriate','other')),
  comment text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_reports_business_id ON public.business_reports(business_id);
CREATE INDEX IF NOT EXISTS idx_business_reports_status ON public.business_reports(status) WHERE status = 'open';

ALTER TABLE public.business_reports ENABLE ROW LEVEL SECURITY;
-- Reporter can read their own submissions (so the UI can show a "submitted"
-- confirmation if needed). No other client-side reads — Dan reads reports via
-- the service role / Supabase Studio.
DROP POLICY IF EXISTS business_reports_self_read ON public.business_reports;
CREATE POLICY business_reports_self_read
  ON public.business_reports FOR SELECT
  USING (auth.uid() = reporter_user_id);


CREATE TABLE IF NOT EXISTS public.user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reporter_business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES public.deal_claims(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('abusive','fraud','no_show','inappropriate','other')),
  comment text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_reports_reported_user_id ON public.user_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON public.user_reports(status) WHERE status = 'open';

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
-- Reporting business can read its own submissions. The reported user gets no
-- read access — they shouldn't see they were flagged.
DROP POLICY IF EXISTS user_reports_self_read ON public.user_reports;
CREATE POLICY user_reports_self_read
  ON public.user_reports FOR SELECT
  USING (auth.uid() = reporter_user_id);


-- Consumer-facing report. Validates the target business exists; the reporter
-- is always auth.uid(). deal_id is optional context.
CREATE OR REPLACE FUNCTION public.report_business(
  target_business_id uuid,
  report_reason text,
  report_comment text DEFAULT NULL,
  related_deal_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  new_id uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = target_business_id) THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.business_reports(business_id, deal_id, reporter_user_id, reason, comment)
  VALUES (target_business_id, related_deal_id, uid, report_reason, NULLIF(trim(report_comment), ''))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_business(uuid, text, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_business(uuid, text, text, uuid) TO authenticated;


-- Business-facing report. Caller must own a business that actually has a
-- redeemable claim from the customer they're reporting (we look it up by
-- claim_id and resolve the user_id server-side so the caller never has to
-- pass — and never learns — the customer's auth uid).
CREATE OR REPLACE FUNCTION public.report_user(
  related_claim_id uuid,
  report_reason text,
  report_comment text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  claim_user uuid;
  claim_business uuid;
  reporter_business uuid;
  new_id uuid;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT dc.user_id, d.business_id
    INTO claim_user, claim_business
  FROM public.deal_claims dc
  JOIN public.deals d ON d.id = dc.deal_id
  WHERE dc.id = related_claim_id;

  IF claim_user IS NULL THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = '23503';
  END IF;

  SELECT id INTO reporter_business
  FROM public.businesses
  WHERE id = claim_business
    AND owner_id = uid;

  IF reporter_business IS NULL THEN
    RAISE EXCEPTION 'not authorized to report this claim' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_reports(
    reported_user_id, reporter_business_id, reporter_user_id, claim_id, reason, comment
  )
  VALUES (
    claim_user, reporter_business, uid, related_claim_id, report_reason, NULLIF(trim(report_comment), '')
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.report_user(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.report_user(uuid, text, text) TO authenticated;

COMMIT;

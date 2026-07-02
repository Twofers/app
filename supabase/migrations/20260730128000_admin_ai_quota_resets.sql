-- Admin-only AI quota reset ledger.
-- Resets are additive audit records; usage history in ai_generation_logs stays intact.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_ai_quota_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_email text,
  quota_scope text NOT NULL CHECK (
    quota_scope IN (
      'ad_generation',
      'compose_offer',
      'deal_copy',
      'deal_suggestions',
      'deal_translate'
    )
  ),
  period_start date NOT NULL,
  reset_at timestamptz NOT NULL DEFAULT now(),
  reset_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_ai_quota_resets_business_scope_period
  ON public.admin_ai_quota_resets(business_id, quota_scope, period_start, reset_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_ai_quota_resets_owner_created
  ON public.admin_ai_quota_resets(owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE public.admin_ai_quota_resets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_ai_quota_resets FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.admin_ai_quota_resets TO service_role;

COMMENT ON TABLE public.admin_ai_quota_resets IS
  'Admin-only additive reset ledger for monthly AI quotas. Edge functions honor the latest reset without deleting ai_generation_logs history.';

CREATE OR REPLACE FUNCTION public.ai_compose_quota_status(p_business_id uuid)
RETURNS TABLE(used_count integer, monthly_limit integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
  v_count_since timestamptz := date_trunc('month', CURRENT_TIMESTAMP);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND b.owner_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  SELECT GREATEST(v_month_start, COALESCE(MAX(r.reset_at), v_month_start))
    INTO v_count_since
  FROM public.admin_ai_quota_resets r
  WHERE r.business_id = p_business_id
    AND r.quota_scope = 'compose_offer'
    AND r.period_start = v_month_start::date;

  RETURN QUERY
  SELECT
    (
      SELECT COUNT(*)::integer
      FROM public.ai_generation_logs g
      WHERE g.business_id = p_business_id
        AND g.request_type = 'compose_offer'
        AND g.openai_called = true
        AND g.success = true
        AND g.created_at >= v_count_since
    ),
    -- Display-only limit shown to the app UI. Enforcement happens in the
    -- ai-compose-offer edge function via the AI_MONTHLY_LIMIT secret
    -- (default 30). If that secret is ever changed, update this value too.
    30;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_compose_quota_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_compose_quota_status(uuid) TO authenticated;

COMMIT;

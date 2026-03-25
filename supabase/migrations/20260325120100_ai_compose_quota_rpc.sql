-- Quota display for business owners (matches default AI_MONTHLY_LIMIT=30 in Edge env).

CREATE OR REPLACE FUNCTION public.ai_compose_quota_status(p_business_id uuid)
RETURNS TABLE(used_count integer, monthly_limit integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND b.owner_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (
      SELECT COUNT(*)::integer
      FROM public.ai_generation_logs g
      WHERE g.business_id = p_business_id
        AND g.request_type = 'compose_offer'
        AND g.openai_called = true
        AND g.success = true
        AND g.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
    ),
    30;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_compose_quota_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_compose_quota_status(uuid) TO authenticated;

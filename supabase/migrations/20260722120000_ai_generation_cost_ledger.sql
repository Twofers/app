-- Private AI cost ledger. Written by service-role Edge Functions only.
-- Do not expose this table or its reporting views to mobile clients.

CREATE TABLE IF NOT EXISTS public.ai_generation_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses (id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.deals (id) ON DELETE SET NULL,
  owner_user_id UUID,
  request_group_id UUID NOT NULL,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  image_input_tokens INTEGER NOT NULL DEFAULT 0,
  image_output_tokens INTEGER NOT NULL DEFAULT 0,
  image_text_input_tokens INTEGER NOT NULL DEFAULT 0,
  audio_seconds NUMERIC NOT NULL DEFAULT 0,
  web_search_calls INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  openai_request_id TEXT,
  response_id TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_generation_costs_request_group
  ON public.ai_generation_costs (request_group_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_generation_costs_business_created
  ON public.ai_generation_costs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_generation_costs_deal_created
  ON public.ai_generation_costs (deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_generation_costs_feature_created
  ON public.ai_generation_costs (feature, created_at DESC);

ALTER TABLE public.ai_generation_costs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_generation_costs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.ai_generation_costs TO service_role;

COMMENT ON TABLE public.ai_generation_costs IS
  'Private internal AI cost ledger. RLS has no client policies; service role/admin only.';

CREATE OR REPLACE VIEW public.ai_generation_cost_daily AS
SELECT
  date_trunc('day', created_at)::date AS day,
  SUM(estimated_cost_usd)::numeric(12,6) AS total_ai_cost_usd,
  COUNT(DISTINCT request_group_id) AS generated_ad_attempts,
  CASE
    WHEN COUNT(DISTINCT request_group_id) = 0 THEN 0::numeric(12,6)
    ELSE (SUM(estimated_cost_usd) / COUNT(DISTINCT request_group_id))::numeric(12,6)
  END AS average_cost_per_generated_ad,
  SUM(web_search_calls)::integer AS web_search_calls,
  COUNT(*) FILTER (WHERE endpoint IN ('images.generations', 'images.edits')) AS image_generation_calls,
  COUNT(*) FILTER (WHERE success = false) AS failed_or_retried_calls
FROM public.ai_generation_costs
GROUP BY 1;

CREATE OR REPLACE VIEW public.ai_generation_cost_by_business AS
SELECT
  business_id,
  SUM(estimated_cost_usd)::numeric(12,6) AS total_ai_cost_usd,
  COUNT(DISTINCT request_group_id) AS generated_ad_attempts,
  SUM(web_search_calls)::integer AS web_search_calls,
  COUNT(*) FILTER (WHERE endpoint IN ('images.generations', 'images.edits')) AS image_generation_calls,
  COUNT(*) FILTER (WHERE success = false) AS failed_or_retried_calls
FROM public.ai_generation_costs
GROUP BY business_id;

CREATE OR REPLACE VIEW public.ai_generation_cost_by_deal AS
SELECT
  deal_id,
  SUM(estimated_cost_usd)::numeric(12,6) AS total_ai_cost_usd,
  COUNT(DISTINCT request_group_id) AS generated_ad_attempts,
  SUM(web_search_calls)::integer AS web_search_calls,
  COUNT(*) FILTER (WHERE endpoint IN ('images.generations', 'images.edits')) AS image_generation_calls,
  COUNT(*) FILTER (WHERE success = false) AS failed_or_retried_calls
FROM public.ai_generation_costs
GROUP BY deal_id;

CREATE OR REPLACE VIEW public.ai_generation_cost_by_feature_model AS
SELECT
  feature,
  model,
  endpoint,
  SUM(estimated_cost_usd)::numeric(12,6) AS total_ai_cost_usd,
  COUNT(*) AS call_count,
  SUM(web_search_calls)::integer AS web_search_calls,
  COUNT(*) FILTER (WHERE success = false) AS failed_or_retried_calls
FROM public.ai_generation_costs
GROUP BY feature, model, endpoint;

REVOKE ALL ON public.ai_generation_cost_daily FROM anon, authenticated;
REVOKE ALL ON public.ai_generation_cost_by_business FROM anon, authenticated;
REVOKE ALL ON public.ai_generation_cost_by_deal FROM anon, authenticated;
REVOKE ALL ON public.ai_generation_cost_by_feature_model FROM anon, authenticated;

GRANT SELECT ON public.ai_generation_cost_daily TO service_role;
GRANT SELECT ON public.ai_generation_cost_by_business TO service_role;
GRANT SELECT ON public.ai_generation_cost_by_deal TO service_role;
GRANT SELECT ON public.ai_generation_cost_by_feature_model TO service_role;

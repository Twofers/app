-- Non-destructive reset marker for the "AI Cost by Feature" report view.
-- Recording a reset row makes ai_generation_cost_by_feature_model count only the
-- spend logged AFTER the latest reset. Raw ai_generation_costs rows are never
-- deleted, so history stays queryable and every other cost view (daily,
-- by-business, by-deal) is unaffected. A reset can be undone by deleting its
-- marker row.

CREATE TABLE IF NOT EXISTS public.ai_generation_cost_ledger_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reset_by_id UUID,
  reset_by_email TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_generation_cost_ledger_resets_reset_at
  ON public.ai_generation_cost_ledger_resets (reset_at DESC);

ALTER TABLE public.ai_generation_cost_ledger_resets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_generation_cost_ledger_resets FROM anon, authenticated;
GRANT SELECT, INSERT ON public.ai_generation_cost_ledger_resets TO service_role;

COMMENT ON TABLE public.ai_generation_cost_ledger_resets IS
  'Non-destructive reset markers for the AI Cost by Feature view. Service role/admin only; no client RLS policies.';

-- Redefine the by-feature view to only count spend since the latest reset marker.
-- The output columns are unchanged (only a WHERE clause is added), so
-- CREATE OR REPLACE VIEW is safe and preserves existing grants.
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
WHERE created_at >= COALESCE(
  (SELECT max(reset_at) FROM public.ai_generation_cost_ledger_resets),
  '-infinity'::timestamptz
)
GROUP BY feature, model, endpoint;

REVOKE ALL ON public.ai_generation_cost_by_feature_model FROM anon, authenticated;
GRANT SELECT ON public.ai_generation_cost_by_feature_model TO service_role;

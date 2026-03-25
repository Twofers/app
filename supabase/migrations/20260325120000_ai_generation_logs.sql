-- AI offer composition: metering, audit trail, duplicate/cooldown support.
-- Rows are written only from Edge Functions (service role).

CREATE TABLE IF NOT EXISTS public.ai_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  business_id UUID NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'compose_offer',
  input_mode TEXT NOT NULL DEFAULT 'unknown',
  source_image_path TEXT,
  prompt_text TEXT,
  voice_transcript TEXT,
  request_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  model TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  quota_blocked BOOLEAN NOT NULL DEFAULT false,
  duplicate_blocked BOOLEAN NOT NULL DEFAULT false,
  duplicate_of_log_id UUID REFERENCES public.ai_generation_logs (id) ON DELETE SET NULL,
  low_confidence BOOLEAN NOT NULL DEFAULT false,
  recommended_offer_type TEXT,
  input_token_count INTEGER,
  output_token_count INTEGER,
  estimated_cost_usd NUMERIC(12, 6),
  response_payload JSONB,
  selected_variant TEXT,
  published_deal_id UUID REFERENCES public.deals (id) ON DELETE SET NULL,
  openai_called BOOLEAN NOT NULL DEFAULT false,
  accepted_by_user BOOLEAN,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_logs_business_created
  ON public.ai_generation_logs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_gen_logs_business_hash_created
  ON public.ai_generation_logs (business_id, request_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_gen_logs_user_created
  ON public.ai_generation_logs (user_id, created_at DESC);

ALTER TABLE public.ai_generation_logs ENABLE ROW LEVEL SECURITY;

-- No policies: clients cannot read/write; service role bypasses RLS.

COMMENT ON TABLE public.ai_generation_logs IS 'Server-side audit for AI compose-offer; inserts via Edge Functions only.';

-- Private provider circuit breaker state. Written by service-role Edge Functions only.
-- Do not expose this table to mobile clients.

CREATE TABLE IF NOT EXISTS public.ai_provider_circuit_breakers (
  provider TEXT NOT NULL,
  capability TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'closed',
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT,
  opened_at TIMESTAMPTZ,
  disabled_until TIMESTAMPTZ,
  last_probe_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, capability),
  CONSTRAINT ai_provider_circuit_breakers_state_check
    CHECK (state IN ('closed', 'open', 'half_open')),
  CONSTRAINT ai_provider_circuit_breakers_failure_count_check
    CHECK (failure_count >= 0)
);

ALTER TABLE public.ai_provider_circuit_breakers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_provider_circuit_breakers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_provider_circuit_breakers TO service_role;

COMMENT ON TABLE public.ai_provider_circuit_breakers IS
  'Private internal AI provider circuit breaker state. RLS has no client policies; service role/admin only.';


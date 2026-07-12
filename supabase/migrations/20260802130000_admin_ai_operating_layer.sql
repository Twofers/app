-- Admin AI operating layer logging extensions.
--
-- This keeps admin/prospect AI work in the existing AI ledgers while allowing
-- prospect-only runs that do not have a claimed business yet. It is additive
-- except for relaxing ai_generation_logs.business_id so admin-only prospect
-- work can be logged without creating fake businesses or deals.

BEGIN;

ALTER TABLE public.ai_generation_logs
  ALTER COLUMN business_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_prospect_id uuid REFERENCES public.business_prospects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS cost_basis_json jsonb,
  ADD COLUMN IF NOT EXISTS sources_json jsonb,
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS safe_for_public_display boolean,
  ADD COLUMN IF NOT EXISTS requires_human_review boolean;

ALTER TABLE public.business_prospect_scores
  DROP CONSTRAINT IF EXISTS business_prospect_scores_tier_check,
  ADD CONSTRAINT business_prospect_scores_tier_check
    CHECK (tier IN ('A', 'B', 'C', 'Do Not Contact'));

CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_admin_created
  ON public.ai_generation_logs(admin_user_id, created_at DESC)
  WHERE admin_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_related_prospect_created
  ON public.ai_generation_logs(related_prospect_id, created_at DESC)
  WHERE related_prospect_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_admin_request_type_created
  ON public.ai_generation_logs(admin_user_id, request_type, created_at DESC)
  WHERE admin_user_id IS NOT NULL;

COMMENT ON COLUMN public.ai_generation_logs.admin_user_id
  IS 'Internal admin user who requested an admin/dashboard AI operation.';

COMMENT ON COLUMN public.ai_generation_logs.related_prospect_id
  IS 'Admin-only prospect identifier related to prospect enrichment, scoring, demand proof, scripts, claim-link support, or trial conversion AI output.';

COMMENT ON COLUMN public.ai_generation_logs.safe_for_public_display
  IS 'Whether the AI output is safe to show outside internal admin review. Prospect facts remain unverified until an admin approves them.';

COMMIT;

-- Single-use email confirmation for low-risk full 30-day trial approvals.
--
-- The raw bearer token is sent only to the configured admin alert inbox. The
-- database stores only its SHA-256 hash. These columns live on the already
-- RLS-closed business_applications table and are used only by service-role
-- Edge Functions. No client policy or policy helper changes are required.

BEGIN;

ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS quick_approval_token_hash text,
  ADD COLUMN IF NOT EXISTS quick_approval_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS quick_approval_token_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS quick_approval_token_issued_to uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quick_approval_processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS quick_approval_processing_request_id uuid,
  ADD COLUMN IF NOT EXISTS quick_approval_token_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS quick_approval_token_used_by uuid REFERENCES public.admin_users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_applications_quick_approval_token_hash
  ON public.business_applications(quick_approval_token_hash)
  WHERE quick_approval_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_applications_quick_approval_expiry
  ON public.business_applications(quick_approval_token_expires_at)
  WHERE quick_approval_token_hash IS NOT NULL
    AND quick_approval_token_used_at IS NULL;

COMMENT ON COLUMN public.business_applications.quick_approval_token_hash IS
  'SHA-256 hex of a single-use email token for a low-risk full 30-day trial approval. The raw token is never stored.';
COMMENT ON COLUMN public.business_applications.quick_approval_token_expires_at IS
  'Hard expiry for the email quick-approval token.';
COMMENT ON COLUMN public.business_applications.quick_approval_token_issued_to IS
  'Active admin_users recipient whose configured inbox received the quick-approval token.';
COMMENT ON COLUMN public.business_applications.quick_approval_processing_request_id IS
  'Short-lived Edge request claim that prevents concurrent confirmation attempts.';
COMMENT ON COLUMN public.business_applications.quick_approval_token_used_at IS
  'Set only after the existing audited approve_full decision path completes.';

COMMIT;

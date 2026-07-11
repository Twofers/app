-- Auto-email approved businesses: trial-welcome + tokenized web checkout link.
--
-- Additive only. Adds send-idempotency bookkeeping and a hashed,
-- application-scoped checkout token to business_applications. No RLS policy or
-- policy-helper changes: business_applications already REVOKEs anon/authenticated
-- and is reached only by service-role edge functions.

BEGIN;

ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS approval_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_email_decision text,
  ADD COLUMN IF NOT EXISTS checkout_token_hash text,
  ADD COLUMN IF NOT EXISTS checkout_token_expires_at timestamptz;

-- The emailed payment link resolves a business_application by the sha256 of its
-- raw token; keep the hash unique so a re-mint or collision can't fan out to
-- more than one application. Partial so historical NULLs don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_applications_checkout_token_hash
  ON public.business_applications(checkout_token_hash)
  WHERE checkout_token_hash IS NOT NULL;

COMMENT ON COLUMN public.business_applications.approval_email_sent_at IS
  'Set once the approval/trial-welcome email was sent. Idempotency guard: never double-send.';
COMMENT ON COLUMN public.business_applications.approval_email_decision IS
  'Which approval decision (approve_limited / approve_full) the sent email described.';
COMMENT ON COLUMN public.business_applications.checkout_token_hash IS
  'sha256 hex of the application-scoped checkout token emailed to the owner. The raw token is never stored.';
COMMENT ON COLUMN public.business_applications.checkout_token_expires_at IS
  'Expiry for the emailed checkout token.';

COMMIT;

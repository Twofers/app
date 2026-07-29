-- Founder security hardening: every admin row must require MFA. The Edge
-- Function guard separately pins production access to FOUNDER_ADMIN_USER_ID,
-- role=owner, active=true, and an aal2 token.

UPDATE public.admin_users
SET require_mfa = true
WHERE require_mfa IS DISTINCT FROM true;

ALTER TABLE public.admin_users
  ALTER COLUMN require_mfa SET DEFAULT true,
  ALTER COLUMN require_mfa SET NOT NULL;

-- Server-owned audit/idempotency records for billing trial-ending reminders.
--
-- This migration prepares the 24-hour push reminder job required for the
-- card-required trial flow. It does not deploy or schedule the Edge Function.

BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_trial_reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_kind text NOT NULL CHECK (reminder_kind IN ('trial_ends_24h_push')),
  trial_ends_at timestamptz NOT NULL,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz NULL,
  send_status text NOT NULL DEFAULT 'pending'
    CHECK (send_status IN ('pending', 'sent', 'skipped_no_tokens', 'send_error')),
  token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_location_id, reminder_kind, trial_ends_at)
);

CREATE INDEX IF NOT EXISTS idx_billing_trial_reminder_events_location_created
  ON public.billing_trial_reminder_events (business_location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_trial_reminder_events_status
  ON public.billing_trial_reminder_events (send_status, scheduled_for);

ALTER TABLE public.billing_trial_reminder_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_trial_reminder_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_trial_reminder_events TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'billing_reminder_cron_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'billing_reminder_cron_secret',
      'x-cron-secret presented by pg_cron to billing reminder Edge Functions'
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.verify_billing_reminder_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'billing_reminder_cron_secret'
      AND decrypted_secret = p_secret
  );
$$;

REVOKE ALL ON FUNCTION public.verify_billing_reminder_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_billing_reminder_secret(text) TO service_role;

COMMENT ON TABLE public.billing_trial_reminder_events
  IS 'Server-owned audit and idempotency table for billing trial reminder delivery.';

COMMENT ON FUNCTION public.verify_billing_reminder_secret(text)
  IS 'Lets billing reminder Edge Functions verify a cron secret without exposing Vault contents.';

COMMIT;

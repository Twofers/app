-- Server-owned audit/idempotency records for customer deal release pushes.
--
-- Scheduled deals are published immediately but become customer-live only when
-- start_time arrives. This ledger lets send-deal-push reserve one release push
-- per deal and lets cron retry without duplicate customer notifications.
-- Do not apply without Dan's explicit migration approval.

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_push_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  push_kind text NOT NULL CHECK (push_kind IN ('deal_release_push')),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz NULL,
  send_status text NOT NULL DEFAULT 'pending'
    CHECK (
      send_status IN (
        'pending',
        'sent',
        'skipped_no_audience',
        'skipped_no_tokens',
        'skipped_not_live',
        'send_error',
        'suppressed_preexisting'
      )
    ),
  token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, push_kind)
);

CREATE INDEX IF NOT EXISTS idx_deal_push_events_pending_release
  ON public.deal_push_events (send_status, scheduled_for)
  WHERE push_kind = 'deal_release_push';

CREATE INDEX IF NOT EXISTS idx_deal_push_events_business_created
  ON public.deal_push_events (business_id, created_at DESC);

ALTER TABLE public.deal_push_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.deal_push_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deal_push_events TO service_role;

INSERT INTO public.deal_push_events (
  deal_id,
  business_id,
  push_kind,
  scheduled_for,
  send_status,
  metadata
)
SELECT
  d.id,
  d.business_id,
  'deal_release_push',
  d.start_time,
  CASE
    WHEN d.is_active IS TRUE
      AND d.start_time > now()
      AND d.end_time > d.start_time
    THEN 'pending'
    ELSE 'suppressed_preexisting'
  END,
  jsonb_build_object(
    'reason',
    CASE
      WHEN d.is_active IS TRUE
        AND d.start_time > now()
        AND d.end_time > d.start_time
      THEN 'future_deal_backfilled_for_release_push'
      ELSE 'preexisting_deal_not_eligible_for_release_push'
    END
  )
FROM public.deals d
WHERE d.start_time IS NOT NULL
ON CONFLICT (deal_id, push_kind) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'deal_release_push_cron_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'deal_release_push_cron_secret',
      'x-cron-secret presented by pg_cron to send due deal release pushes'
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.verify_deal_release_push_secret(p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'deal_release_push_cron_secret'
      AND decrypted_secret = p_secret
  );
$$;

REVOKE ALL ON FUNCTION public.verify_deal_release_push_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_deal_release_push_secret(text) TO service_role;

COMMENT ON TABLE public.deal_push_events
  IS 'Service-role-only audit/idempotency table for one customer release push per deal.';

COMMENT ON FUNCTION public.verify_deal_release_push_secret(text)
  IS 'Lets send-deal-push verify the deal release push cron secret without exposing Vault contents.';

COMMIT;

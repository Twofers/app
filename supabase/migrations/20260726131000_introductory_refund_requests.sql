-- Server-owned owner-requested introductory refund audit table.
--
-- Refunds are executed only by the Stripe refund Edge Function and verified
-- Stripe webhooks remain the provider-event audit trail.

BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_paid_invoice_id text NOT NULL,
  provider text NOT NULL DEFAULT 'stripe',
  provider_refund_id text NULL UNIQUE,
  provider_charge_id text NULL,
  provider_payment_intent_id text NULL,
  request_status text NOT NULL DEFAULT 'pending'
    CHECK (request_status IN ('pending', 'approved', 'requires_support', 'rejected', 'failed')),
  reason_code text NULL,
  credits_used_at_request integer NOT NULL DEFAULT 0 CHECK (credits_used_at_request >= 0),
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_location_id, first_paid_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_refund_requests_location_created
  ON public.billing_refund_requests (business_location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_refund_requests_status
  ON public.billing_refund_requests (request_status, requested_at);

ALTER TABLE public.billing_refund_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_refund_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_refund_requests TO service_role;

COMMENT ON TABLE public.billing_refund_requests
  IS 'Server-owned audit table for owner-requested first-paid-invoice introductory refunds.';

COMMIT;

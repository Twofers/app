-- Create subscription_history table referenced by stripe-webhook edge function.
-- Tracks subscription state changes for audit / debugging.

BEGIN;

CREATE TABLE IF NOT EXISTS public.subscription_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  event_type      text,                       -- app-level: trial_start, subscription_created, subscription_canceled, etc.
  stripe_event_type text,                     -- raw Stripe event type (e.g. customer.subscription.updated)
  stripe_event_id text,                       -- Stripe event id for idempotency / tracing
  subscription_tier   text,                   -- pro, premium at time of event
  subscription_status text,                   -- trial, active, past_due, canceled at time of event
  stripe_subscription_id text,                -- Stripe subscription id, nullable
  payload         jsonb,                      -- full Stripe event payload for debugging
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookups by business
CREATE INDEX IF NOT EXISTS idx_subscription_history_business_profile_id
  ON public.subscription_history (business_profile_id);

-- Index for deduplication by Stripe event id
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_history_stripe_event_id
  ON public.subscription_history (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- Enable RLS
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;

-- Business owners can read their own history
CREATE POLICY "Business owners can read their own subscription history"
  ON public.subscription_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.id = subscription_history.business_profile_id
        AND (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    )
  );

-- Only service_role (edge functions) can insert — no client INSERT policy needed.
-- The stripe-webhook edge function uses the service_role key which bypasses RLS.

COMMIT;

-- Idempotency for the Stripe webhook handler.
--
-- Note: an earlier migration (20260601160000_create_subscription_history.sql) already
-- creates the table AND a unique index on stripe_event_id. However, the hosted DB had
-- migration drift (per pilot launch notes) — the migration was marked applied without
-- actually creating the table. This migration is defensive: it ensures the table and
-- index exist regardless of prior drift, then verifies idempotency support.

CREATE TABLE IF NOT EXISTS public.subscription_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  event_type      text,
  stripe_event_type text,
  stripe_event_id text,
  subscription_tier   text,
  subscription_status text,
  stripe_subscription_id text,
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Pre-check: refuse to apply if existing data has duplicate stripe_event_ids.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*)
    INTO v_dupes
    FROM (
      SELECT stripe_event_id, count(*) AS n
        FROM public.subscription_history
        WHERE stripe_event_id IS NOT NULL
        GROUP BY stripe_event_id
        HAVING count(*) > 1
    ) AS dupes;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot create unique index: % stripe_event_id values are duplicated. Clean up before applying this migration.',
      v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_history_stripe_event_id_unique
  ON public.subscription_history (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscription_history_business_profile_id
  ON public.subscription_history (business_profile_id);

ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_history'
      AND policyname = 'Business owners can read their own subscription history'
  ) THEN
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
  END IF;
END $$;

COMMENT ON INDEX public.subscription_history_stripe_event_id_unique
  IS 'Idempotency guard for Stripe webhook handler. The handler must INSERT ... ON CONFLICT (stripe_event_id) DO NOTHING and skip the business_profiles update when the insert was a no-op (already-processed event).';

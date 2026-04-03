-- Billing subscriptions table: tracks Stripe subscription state per business
CREATE TABLE billing_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan_tier TEXT NOT NULL DEFAULT 'trial',  -- 'trial' | 'pro'
  status TEXT NOT NULL DEFAULT 'trialing',  -- 'trialing' | 'active' | 'canceled' | 'past_due'
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;

-- Business owners can read their own subscription
CREATE POLICY "billing_subscriptions_owner_read" ON billing_subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = billing_subscriptions.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- No direct INSERT/UPDATE from client — managed by edge functions with service role

CREATE INDEX idx_billing_subs_business_id ON billing_subscriptions(business_id);
CREATE INDEX idx_billing_subs_stripe_customer ON billing_subscriptions(stripe_customer_id);
CREATE INDEX idx_billing_subs_stripe_sub ON billing_subscriptions(stripe_subscription_id);

-- Create trial subscriptions for existing businesses that don't have one
INSERT INTO billing_subscriptions (business_id, plan_tier, status, trial_ends_at)
SELECT
  id AS business_id,
  'trial' AS plan_tier,
  'trialing' AS status,
  NOW() + INTERVAL '30 days' AS trial_ends_at
FROM businesses
WHERE NOT EXISTS (
  SELECT 1 FROM billing_subscriptions bs WHERE bs.business_id = businesses.id
);

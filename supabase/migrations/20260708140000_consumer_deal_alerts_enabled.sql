-- Server-side mirror of the consumer's in-app "deal alerts" toggle.
--
-- The opt-in flag lives in the client's secure store (getAlertsEnabled). Server-sent
-- pushes can't read that, so we sync it here and require it true before targeting a
-- user with the weekly digest. Defaults false (opt-in).
ALTER TABLE public.consumer_profiles
  ADD COLUMN IF NOT EXISTS deal_alerts_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consumer_profiles.deal_alerts_enabled IS
  'Mirrors the app deal-alerts opt-in (synced from the client). Weekly-digest targeting requires this = true.';

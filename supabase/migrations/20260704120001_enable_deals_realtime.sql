-- Enable Supabase Realtime on the deals table so consumer feeds
-- receive live INSERT events when a business publishes a deal.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

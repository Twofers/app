-- Public discovery: hide deals that have not started yet (scheduled future one-time deals).
DROP POLICY IF EXISTS "Anyone can read active deals" ON public.deals;

CREATE POLICY "Anyone can read active deals"
  ON public.deals FOR SELECT
  USING (
    is_active = true
    AND end_time > NOW()
    AND start_time <= NOW()
  );

-- Templates: store timezone for recurring patterns (parity with deals.timezone)
ALTER TABLE IF EXISTS public.deal_templates
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Chicago';

-- Allow business owners to read analytics rows for their own deals (dashboard "views" metric).
-- Consumers insert via ingest-analytics-event; merchants aggregate in the app client.

DROP POLICY IF EXISTS "app_analytics_events_select_deal_owner" ON public.app_analytics_events;

CREATE POLICY "app_analytics_events_select_deal_owner"
  ON public.app_analytics_events FOR SELECT
  TO authenticated
  USING (
    deal_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.deals d
      INNER JOIN public.businesses b ON b.id = d.business_id
      WHERE d.id = deal_id
        AND b.owner_id = auth.uid()
    )
  );

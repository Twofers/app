-- Allow customers to read deal rows for deals they have claimed (wallet / history).
-- Without this, RLS only exposes active future deals, so ended deals disappear from the client.

CREATE POLICY "Users can read deals they claimed"
  ON public.deals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.deal_claims dc
      WHERE dc.deal_id = deals.id
        AND dc.user_id = auth.uid()
    )
  );

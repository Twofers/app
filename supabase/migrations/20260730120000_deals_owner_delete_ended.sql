-- Allow business owners to delete their own ended deals from My offers.
-- Do not apply without Dan's explicit migration approval.

BEGIN;

DROP POLICY IF EXISTS "Businesses can delete ended own deals" ON public.deals;

CREATE POLICY "Businesses can delete ended own deals"
  ON public.deals FOR DELETE
  TO authenticated
  USING (
    end_time <= now()
    AND EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = deals.business_id
        AND b.owner_id = auth.uid()
    )
  );

COMMIT;

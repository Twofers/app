-- Enforce per-tier max number of business locations at the database level.
-- Pro: 1 location, Premium: up to 3 locations.
BEGIN;

DROP POLICY IF EXISTS "Owners can insert their business locations" ON public.business_locations;

CREATE POLICY "Owners can insert their business locations"
  ON public.business_locations FOR INSERT
  WITH CHECK (
    -- Ownership / access check (matches billing v4 policy semantics).
    EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.id = business_locations.business_id
        AND (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    )
    AND
    -- Cap check: count locations already owned by this business (excluding the row being inserted),
    -- and ensure the count stays strictly below the tier's max allowed.
    (
      SELECT COUNT(*)
      FROM public.business_locations bl
      WHERE bl.business_id = business_locations.business_id
        AND bl.id <> business_locations.id
    ) <
    (
      SELECT CASE
        WHEN bp.subscription_tier = 'premium' THEN 3
        ELSE 1
      END
      FROM public.business_profiles bp
      WHERE bp.id = business_locations.business_id
        AND (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    )
  );

COMMIT;


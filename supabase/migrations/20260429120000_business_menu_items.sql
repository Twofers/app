-- Saved menu lines per business (owner-only; not exposed to consumers).

CREATE TABLE IF NOT EXISTS public.business_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  price_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'scan' CHECK (source IN ('scan', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_menu_items_business_sort
  ON public.business_menu_items (business_id, sort_order, created_at DESC);

ALTER TABLE public.business_menu_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their business menu items"
  ON public.business_menu_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_menu_items.business_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can insert their business menu items"
  ON public.business_menu_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_menu_items.business_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update their business menu items"
  ON public.business_menu_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_menu_items.business_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete their business menu items"
  ON public.business_menu_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_menu_items.business_id AND b.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.business_menu_items IS 'Owner-saved menu lines from scan or manual entry; used to build offers.';

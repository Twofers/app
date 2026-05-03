ALTER TABLE public.business_menu_items
ADD COLUMN IF NOT EXISTS size_options TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.business_menu_items.size_options IS 'Menu sizes or variants extracted from visible menu text, e.g. 12 oz, 16 oz, Small, Large.';

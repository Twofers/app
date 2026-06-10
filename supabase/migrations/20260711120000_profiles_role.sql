-- Hard Shopper/Business role split (spec section 4, item 2, decided 2026-06-10).
-- The role is picked once at signup and never changes. `app_tab_mode` stays for
-- old installed builds that still upsert it, but routing no longer reads it.
--
-- DO NOT APPLY without Dan's explicit approval (hard gate). Must be applied
-- before the role-split build ships; the client falls back to deriving the
-- role from `businesses` ownership until then.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('customer', 'business'));

COMMENT ON COLUMN public.profiles.role IS
  'Permanent account role chosen at signup: customer (Shopper) or business. Replaces app_tab_mode for routing.';

-- Existing accounts derive their permanent role from data:
-- owns a businesses row -> business, otherwise customer. app_tab_mode is
-- ignored because the old build reset it to ''customer'' on every sign-out.
UPDATE public.profiles p
SET role = CASE
  WHEN EXISTS (SELECT 1 FROM public.businesses b WHERE b.owner_id = p.id) THEN 'business'
  ELSE 'customer'
END
WHERE p.role IS NULL;

-- Business owners whose profiles row was never created (profiles rows were
-- only written by the old client upsert) still need a role to land on.
INSERT INTO public.profiles (id, role)
SELECT DISTINCT b.owner_id, 'business'
FROM public.businesses b
WHERE b.owner_id IS NOT NULL
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role WHERE public.profiles.role IS NULL;

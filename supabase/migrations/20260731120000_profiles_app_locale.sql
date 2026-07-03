-- Persist the user's app language so server-originated notifications can use
-- the recipient's language instead of the business/source deal language.
-- DO NOT APPLY without Dan's explicit approval (database hard gate).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_locale TEXT CHECK (app_locale IN ('en', 'es', 'ko'));

COMMENT ON COLUMN public.profiles.app_locale IS
  'User app language for server-rendered copy such as push notifications: en, es, or ko. NULL falls back to English.';

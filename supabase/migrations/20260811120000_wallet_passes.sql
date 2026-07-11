-- Native wallet pass ("Twofer Card"): one Apple/Google Wallet pass per user that
-- mirrors the current active claim. Plan: docs/plans/native-wallet-pass-plan.md.
--
-- Additive only: creates two new service-role-only tables. It does NOT touch any
-- existing table, policy, or policy helper function. After applying, run
-- `node scripts/probe-rls-smoke.mjs` per repo validation rules.

CREATE TABLE IF NOT EXISTS public.wallet_passes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Apple pass identity (minted at first Apple issuance; null until then).
  apple_serial_number text UNIQUE,
  -- SHA-256 (base64url) of the pass authenticationToken; raw token lives only inside the .pkpass.
  apple_auth_token_hash text,
  -- Google Wallet object id: "<issuerId>.twofer-card-<user_id>" (null until first Google issuance).
  google_object_id text UNIQUE,
  -- Language the pass content renders in; reused for every update.
  pass_locale text NOT NULL DEFAULT 'en' CHECK (pass_locale IN ('en', 'es', 'ko')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Apple PassKit device registrations (one row per device that added the pass);
-- used to target APNs update pushes. Google needs no registration (object PATCH).
CREATE TABLE IF NOT EXISTS public.wallet_pass_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.wallet_passes(user_id) ON DELETE CASCADE,
  device_library_identifier text NOT NULL,
  apns_push_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_library_identifier)
);

CREATE INDEX IF NOT EXISTS idx_wallet_pass_registrations_user_id
  ON public.wallet_pass_registrations (user_id);

-- Service-role only: RLS on with NO policies (default deny). All reads/writes go
-- through edge functions. Per the 2026-06-10 lesson, revoking from PUBLIC alone is
-- not enough on Supabase — anon and authenticated hold direct grants too.
ALTER TABLE public.wallet_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pass_registrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wallet_passes FROM PUBLIC;
REVOKE ALL ON public.wallet_passes FROM anon;
REVOKE ALL ON public.wallet_passes FROM authenticated;
REVOKE ALL ON public.wallet_pass_registrations FROM PUBLIC;
REVOKE ALL ON public.wallet_pass_registrations FROM anon;
REVOKE ALL ON public.wallet_pass_registrations FROM authenticated;

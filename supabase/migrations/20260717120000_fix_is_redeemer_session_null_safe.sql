-- HOTFIX (applied to prod by hand 2026-06-11, recorded here so the repo matches).
--
-- 20260712120000 defined is_redeemer_session() as
--   SELECT COALESCE(jwt->>'app_role', jwt->'app_metadata'->>'app_role') = 'redeemer'
-- For every NORMAL user neither claim exists, so the comparison is
-- NULL = 'redeemer' -> NULL, not false. All 21 redeemer_*_block_all RESTRICTIVE
-- policies are USING (NOT public.is_redeemer_session()); NOT NULL is still NULL,
-- and a RESTRICTIVE policy must evaluate TRUE to pass — so every authenticated
-- user was locked out of every guarded table (first symptom: consumer onboarding
-- could not save a ZIP; the deals feed was blocked too).
--
-- Fix: wrap the comparison so missing claims evaluate to false. Staff JWTs
-- (app_metadata.app_role = 'redeemer') still evaluate true; the redeemer
-- lockdown is unchanged.
--
-- Lesson recorded in twofer-developer-handoff-spec.md working rules: any
-- migration touching RLS must be smoke-tested with a real authenticated user
-- JWT (scripts/probe-rls-smoke.mjs) immediately after applying.

CREATE OR REPLACE FUNCTION public.is_redeemer_session()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    COALESCE(
      auth.jwt() ->> 'app_role',
      auth.jwt() -> 'app_metadata' ->> 'app_role'
    ) = 'redeemer',
    false
  );
$$;

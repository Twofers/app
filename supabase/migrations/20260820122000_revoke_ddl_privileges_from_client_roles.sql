-- Step 3 of 3 in the businesses column-grant repair — the systemic half.
--
-- FINDING
-- Every table in public that predates the repo's REVOKE convention sits on the
-- hosted Supabase project's baseline `GRANT ALL ... TO anon, authenticated`.
-- Production shows anon and authenticated holding INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES and TRIGGER on public.businesses, and the same pattern
-- covers roughly 18 tables including deals, deal_claims, profiles,
-- consumer_profiles, business_profiles, push_tokens, app_analytics_events,
-- business_locations, subscription_history and ai_generation_logs. Thirteen of
-- those are already on the SENSITIVE_TABLES list in
-- scripts/probe-rls-inventory.mjs.
--
-- Nothing in this repo issues those grants — there is no `GRANT ALL` and no
-- ALTER DEFAULT PRIVILEGES anywhere in supabase/, scripts/ or docs/. They are
-- inherited from the project baseline. Tables created from 20260701120001
-- onward each carry an explicit `REVOKE ALL ... FROM anon, authenticated`;
-- everything older does not.
--
-- SCOPE OF THIS MIGRATION — deliberately narrow.
-- TRUNCATE, REFERENCES and TRIGGER are DDL-adjacent and are NOT subject to RLS.
-- None is reachable through PostgREST, so this is defence in depth rather than
-- an open exploit: reaching TRUNCATE would require a SQL-injectable
-- SECURITY INVOKER function running as anon/authenticated, and this repo's RPCs
-- are overwhelmingly SECURITY DEFINER with a pinned search_path. Revoking them
-- costs nothing: REFERENCES is only consumed when creating a foreign key that
-- points AT the table, TRIGGER only by CREATE TRIGGER, and both are done by the
-- migration role, never by a client. Existing FKs and triggers keep working —
-- the privilege is not needed for a trigger to fire.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- It leaves the default INSERT/UPDATE/DELETE grants alone. Those are the ones an
-- RLS policy bug would actually expose, but they are load-bearing: many client
-- paths write through PostgREST under RLS. Revoking them table-by-table needs a
-- per-table read of which writes are legitimate and is tracked separately in
-- docs/plans/businesses-column-grant-repair-plan.md. Shipping a TRUNCATE-only
-- revoke and calling the area done would be false comfort.

BEGIN;

-- Point-in-time sweep over everything that exists today.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- The sweep above does not cover tables created later. Without this the fix
-- decays with the next migration — the same trap 20260705120000 documented for
-- function EXECUTE grants ("Supabase default privileges grant EXECUTE to anon on
-- every new function"). Note the standing caveat: ALTER DEFAULT PRIVILEGES only
-- applies to objects created by the role that issues it. Migrations run as the
-- project owner, so tables created by migrations are covered; anything created
-- by a different role in the SQL editor is not.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

COMMIT;

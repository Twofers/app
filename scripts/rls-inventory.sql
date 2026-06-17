-- RLS / grant inventory — release-gate area 2 (catalog half).
--
-- Read-only. Inspects the catalog (no table data is read or written). Run with
-- a service-role / owner connection string, e.g.:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/rls-inventory.sql
--
-- The final DO block fails (psql exits non-zero with ON_ERROR_STOP=1) when a
-- table is reachable through the Data API (granted to anon/authenticated) AND
-- has RLS disabled — the exact condition Supabase warns is unsafe. The three
-- SELECTs above it are the inventories from the audit spec, for the report.

\echo '== 1. public tables WITHOUT row-level security =='
select n.nspname as schema, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by c.relname;

\echo '== 2. RLS policies in public =='
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

\echo '== 3. tables granted to anon / authenticated =='
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

\echo '== GATE: Data API-exposed tables without RLS (must be empty) =='
do $$
declare
  exposed text;
begin
  select string_agg(format('%I', c.relname), ', ' order by c.relname)
  into exposed
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and exists (
      select 1
      from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.table_name = c.relname
        and g.grantee in ('anon', 'authenticated')
    );

  if exposed is not null then
    raise exception
      'RLS GATE FAILED: tables reachable via the Data API with RLS disabled: %', exposed;
  end if;

  raise notice 'RLS gate passed: every Data API-exposed table has RLS enabled.';
end $$;

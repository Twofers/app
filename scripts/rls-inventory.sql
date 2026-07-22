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

\echo '== GATE: DDL privileges held by client roles (must be empty) =='
-- The gate above keys on `not c.relrowsecurity`, so a table with RLS enabled
-- passes no matter what privileges anon/authenticated hold on it. That is how
-- the 2026-07-19 businesses over-grant went unnoticed: every affected table had
-- RLS on, so the inventory stayed green while authenticated held table-level
-- SELECT plus TRUNCATE on ~18 tables.
--
-- TRUNCATE, REFERENCES and TRIGGER are not subject to RLS at all, so RLS being
-- enabled says nothing about them. Assert directly that no client role holds
-- them. Repaired by 20260820122000; this keeps it from drifting back.
do $$
declare
  offenders text;
begin
  select string_agg(
           format('%s(%s: %s)', g.table_name, g.grantee, g.privilege_type),
           ', ' order by g.table_name, g.grantee, g.privilege_type)
  into offenders
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee in ('anon', 'authenticated')
    and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');

  if offenders is not null then
    raise exception
      'GRANT GATE FAILED: client roles hold DDL privileges: %', offenders;
  end if;

  raise notice 'Grant gate passed: no TRUNCATE/REFERENCES/TRIGGER for anon or authenticated.';
end $$;

\echo '== GATE: businesses PII columns not readable by client roles (must be empty) =='
-- Guards the specific regression this suite missed. role_table_grants lists
-- TABLE-level grants only, so a table-level SELECT on businesses shows up here
-- while the intended column-level grants do not — meaning any row for
-- businesses/SELECT is by definition the over-grant, not the intended state.
-- See 20260705120000 and 20260820121000.
do $$
declare
  overgranted text;
begin
  select string_agg(g.grantee, ', ' order by g.grantee)
  into overgranted
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name = 'businesses'
    and g.grantee in ('anon', 'authenticated')
    and g.privilege_type = 'SELECT';

  if overgranted is not null then
    raise exception
      'GRANT GATE FAILED: table-level SELECT on public.businesses held by: % (expected column-level grants only; owner_id/business_email/contact_name/tone and the internal governance columns must stay ungranted)', overgranted;
  end if;

  raise notice 'Grant gate passed: businesses SELECT is column-level only.';
end $$;

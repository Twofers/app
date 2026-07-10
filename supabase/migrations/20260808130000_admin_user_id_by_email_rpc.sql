-- Resolve an auth user's id by email WITHOUT enumerating the whole user list.
--
-- Context: admin-ai-usage previously resolved an owner by calling
--   supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
-- and scanning the results. GoTrue's admin list endpoint returns
--   HTTP 500 {"error_code":"unexpected_failure","msg":"Database error finding users"}
-- at larger page sizes whenever any auth.users row is malformed (e.g. NULL in
-- token columns GoTrue serializes as empty strings). That crashed the entire
-- AI-usage lookup with a bare EDGE_FUNCTION_ERROR (no CORS headers), which the
-- admin UI misreported as "Could not reach the admin AI usage service".
--
-- A direct, indexed email lookup is both robust (unaffected by malformed rows
-- elsewhere in the table) and cheap. This mirrors the auth.admin.listUsers ban
-- already enforced on other edge functions.

create or replace function public.admin_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  order by u.created_at asc
  limit 1
$$;

comment on function public.admin_user_id_by_email(text) is
  'Service-role-only: resolves an auth user id by email for admin tooling without enumerating auth.users. Replaces GoTrue listUsers, which 500s on malformed rows.';

-- Lock it down: service_role only (edge functions call it with the service key).
-- REVOKE FROM PUBLIC alone is insufficient on Supabase; also strip anon/authenticated.
revoke all on function public.admin_user_id_by_email(text) from public;
revoke all on function public.admin_user_id_by_email(text) from anon;
revoke all on function public.admin_user_id_by_email(text) from authenticated;
grant execute on function public.admin_user_id_by_email(text) to service_role;

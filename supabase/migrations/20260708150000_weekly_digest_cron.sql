-- Schedule the weekly-deal-digest edge function via pg_cron + pg_net.
--
-- The shared secret pg_cron presents to the function is generated server-side and
-- stored in Supabase Vault — it is NEVER committed to source control. The function
-- verifies a presented secret through verify_weekly_digest_secret() (it also accepts
-- a CRON_SECRET env for manual/ops invocation).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Cron secret in Vault (generate once).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'weekly_digest_cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'weekly_digest_cron_secret',
      'x-cron-secret presented by pg_cron to the weekly-deal-digest edge function'
    );
  end if;
end
$$;

-- 2) Let the edge function (service_role) verify a presented secret without exposing Vault.
create or replace function public.verify_weekly_digest_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'weekly_digest_cron_secret'
      and decrypted_secret = p_secret
  );
$$;
revoke all on function public.verify_weekly_digest_secret(text) from public;
grant execute on function public.verify_weekly_digest_secret(text) to service_role;

-- 3) Read-only status helper (for verification / proof).
create or replace function public.weekly_digest_cron_status()
returns table (jobname text, schedule text, active boolean)
language sql
security definer
set search_path = ''
as $$
  select jobname, schedule, active from cron.job where jobname = 'weekly-deal-digest';
$$;
revoke all on function public.weekly_digest_cron_status() from public;
grant execute on function public.weekly_digest_cron_status() to service_role;

-- 4) (Re)schedule weekly — Saturdays 17:00 UTC (~11:00 America/Chicago).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-deal-digest') then
    perform cron.unschedule('weekly-deal-digest');
  end if;
  perform cron.schedule(
    'weekly-deal-digest',
    '0 17 * * 6',
    $cron$
      select net.http_post(
        url := 'https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/weekly-deal-digest',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_digest_cron_secret')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
end
$$;

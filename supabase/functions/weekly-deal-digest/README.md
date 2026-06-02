# weekly-deal-digest

Sends a personalized weekly "N new deals near you this week" push to opted-in
consumers (push token + `consumer_profiles.notification_mode != 'none'`) who have
≥1 deal created in the last 7 days within their radius.

## Setup

1. Set the shared secret on the function (so only the scheduler can invoke it):

   ```bash
   supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
   ```

2. Deploy:

   ```bash
   supabase functions deploy weekly-deal-digest
   ```

3. Verify manually (should return JSON like `{ ok: true, audience, tokens, sent, errors }`):

   ```bash
   curl -X POST "https://<PROJECT_REF>.functions.supabase.co/weekly-deal-digest" \
     -H "x-cron-secret: <CRON_SECRET>" -H "Content-Type: application/json" -d '{}'
   ```

## Schedule weekly (pick one)

**A. Supabase Dashboard → Database → Cron** (simplest): new job, schedule
`0 17 * * 6` (Sat 17:00 UTC ≈ 11:00 CT), command an `net.http_post` to the
function URL with the `x-cron-secret` header.

**B. pg_cron + pg_net** (SQL). Store the secret in Vault, then:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('weekly-deal-digest', '0 17 * * 6', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/weekly-deal-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$$);
```

> Not baked into a migration on purpose: it embeds a project-ref URL and a secret
> reference, which are environment-specific. Configure it once per project.

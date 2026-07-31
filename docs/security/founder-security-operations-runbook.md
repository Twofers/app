# Founder security operations runbook

This is the console/production half of the founder hardening plan. Repository
controls are staged, but nothing in this runbook authorizes a migration,
function deploy, website deploy, DNS change, secret change, paid add-on, or
provider-account mutation.

## Activation order for the staged admin changes

Do these in one approved maintenance window; the new guard fails closed if its
configuration is absent.

1. Founder selection completed 2026-07-29: preserve `unvmex2@gmail.com`. The
   read-only posture query mapped it to the active owner UUID that must be used
   for `FOUNDER_ADMIN_USER_ID`. Do not place that UUID in source control. Leave
   the second owner unchanged until the selected founder login is proven.
2. Completed 2026-07-29: set and verify non-empty hosted digests for
   `FOUNDER_ADMIN_USER_ID`, `ADMIN_SECURITY_ALERT_EMAIL`, and
   `ANON_ABUSE_IP_HASH_SECRET` without recording their values. Dan selected the
   separately controlled `unvmex2@hotmail.com` mailbox as the bootstrap alert
   destination.
3. Completed 2026-07-29: applied, in repository order, mandatory admin MFA,
   account-deletion rate limiting, anonymous analytics rate limiting, and
   atomic public-submission rate limiting. Linked parity was confirmed through
   `20260824130000`; all admin rows now require MFA.
4. Completed 2026-07-29: deployed `admin-auth-session`, every admin function
   importing `_shared/admin-prospects.ts`, `delete-user-account`,
   `ingest-analytics-event`, `submit-business-application`, and
   `submit-launch-signup` (28 total). All versions advanced, all remained
   active, the two JWT-enforced functions retained their mode, and all
   anonymous smoke/rate-limit probes passed.
5. In Vercel, set a 32-random-byte base64url
   `ADMIN_SESSION_ENCRYPTION_KEY`, `SUPABASE_URL`, and the optional
   `SUPABASE_FUNCTIONS_BASE_URL`. Deploy the exact reviewed commit by manual
   production promotion.
6. Sign in as the chosen founder and enroll/verify TOTP. Confirm a non-founder
   owner receives 403, an AAL1 session receives 403, and the admin browser has
   no Supabase access/refresh token in Local or Session Storage.
7. Verify the external alert on login and a reversible lifecycle action.
8. Only after successful founder access, deactivate/demote the second owner row
   through an approved database operation. The dashboard intentionally refuses
   to manage admin accounts.

Rollback is code/config rollback to the last reviewed SHA. Do not roll back the
rate-limit ledgers by dropping them; they are inert if callers stop using the
RPCs.

## Supabase control plane

- The timestamped read-only CLI result is
  `docs/security/supabase-control-plane-snapshot-2026-07-29.json`: database SSL
  enforcement is currently false and network restrictions permit
  `0.0.0.0/0` plus `::/0`; the physical-backup list is empty and PITR is false.
- Backups/PITR: inspect the Dashboard Backups page. The 2026-07-29 bootstrap
  review confirmed the project is on the Free plan and has no scheduled
  backups. The bootstrap decision defers paid PITR while a 24-hour recovery
  point is acceptable; use the free-tier immutable path in
  `backup-and-restore-runbook.md`.
- SSL enforcement is enabled on the separate `twofer testing` project
  (`zsuzrerdailvylccqtds`) and it returned to `ACTIVE_HEALTHY`. Validate every
  direct test-database client, then separately approve production; production
  was inspected after the test change and remains unchanged:
  https://supabase.com/docs/guides/platform/ssl-enforcement
- Restrict direct Postgres and pooler routes to the static VPN/admin and backup
  runner IP/CIDR set. Include both IPv4 and IPv6 where applicable:
  https://supabase.com/docs/guides/platform/network-restrictions
- Rotate the database password only after allowed clients pass. Revoke old
  personal access tokens and remove persistent production CLI authentication
  from the daily-use machine.
- The 2026-07-29 signed-in Security Advisor/CLI scan is recorded in
  `supabase-security-advisor-snapshot-2026-07-29.json`: the initial scan found
  2 errors and 171 warnings, and anon could read 14 per-deal metric rows through
  the untracked `public.deal_stats` SECURITY DEFINER view. The separately
  approved `20260824131000_harden_legacy_reporting_views.sql` is now live;
  both views return 401 to anon and Advisor reports 0 errors. Triage the
  remaining 144 warnings by function reachability before changing grants; the
  first-pass ledger is
  `supabase-security-advisor-warning-triage-2026-07-29.md`. Migration
  `20260824132000_remove_public_bucket_listing_policies.sql` was separately
  approved/applied at $0. Anon listings now expose zero entries for both
  buckets, while sampled public logo/poster URLs remain HTTP 200. The 2026-07-29 deep
  catalog grant probe passed:
  `PUBLIC`, anon, and authenticated have no TRUNCATE, REFERENCES, or TRIGGER
  privileges on public-schema relations.
- Migration `20260824133000_pin_remaining_function_search_paths.sql` was
  separately approved/applied at $0 added recurring cost. Migration parity is
  exact through `20260824133000`; Advisor reports 0 errors, 144 warnings, and
  zero mutable-search-path findings. Representative pure, read-only RPCs
  returned HTTP 200 with expected results under both service-role and current
  anon credentials.
- Migration `20260824134000_revoke_trigger_function_client_execute.sql` was
  separately approved/applied at $0 added recurring cost. Parity is exact
  through `20260824134000`; all 13 trigger bindings remain enabled,
  service-role access remains on all 13 functions, client catalog execution is
  zero, all 13 anon RPC routes return HTTP 404, and Advisor reports 0 errors
  and 118 warnings.
- Migration `20260824135000_revoke_service_role_function_client_execute.sql`
  was separately approved/applied at $0 added recurring cost. Parity is exact
  through `20260824135000`; all 22 functions have zero client execution and
  retained service-role execution. All 22 anon routes are denied, 11
  representative trusted read-only RPCs return HTTP 200, and Advisor reports
  0 errors and 74 warnings.
- Migration `20260824140000_revoke_nonpublic_function_anon_execute.sql` is
  separately approved/applied at $0 added recurring cost. Parity is exact
  through `20260824140000`; all 24 functions have zero anonymous execution and
  retained authenticated/service-role execution. All 24 removed anon routes
  return HTTP 401, all seven intentional public RPCs return HTTP 200, 15
  representative trusted read-only RPCs return HTTP 200, and Advisor reports
  0 errors and 50 warnings.
- Migration `20260824141000_revoke_internal_helper_client_execute.sql` is
  separately approved/applied at $0 added recurring cost. Parity is exact
  through `20260824141000`; all six helpers have zero client execution and
  retained service-role execution. The cleanup cron job remains active, all
  four dependent triggers remain enabled, all six anon routes are denied, four
  representative trusted read-only RPCs return HTTP 200, and Advisor reports
  0 errors and 44 warnings.
- Migration `20260824142000_revoke_location_ownership_helper_client_execute.sql`
  was separately approved/applied at $0 added recurring cost. Parity is exact
  through `20260824142000`; client catalog execution is zero and service-role
  execution remains. Its anon RPC route returns HTTP 401, its service-role RPC
  returns HTTP 200, and Advisor reports 0 errors and 43 warnings.
- Review leaked-password protection, Auth rate limits, OTP expiry, CAPTCHA,
  SMTP sender/domain, and OAuth callbacks.
- Create fresh throwaway QA users and run authenticated cross-tenant,
  normal-business rejection, and RLS probes. Never reuse founder credentials.
- Decide the production reviewer/demo account’s lifecycle.

The promo owner-read gap and deals-SELECT drift named by the old tracker are
already fixed and applied by migrations `20260819140000` and `20260812130000`.

## Provider root-of-trust checklist

For each provider: require phishing-resistant MFA where offered, save recovery
offline, review members/sessions/tokens, remove stale access, record the
account owner, and exercise the documented re-issue path without exposing
secret values.

- Stripe: founder MFA/recovery; payout-bank alerts; least-privilege restricted
  keys by function group; webhook signing-secret rotation; Radar review.
  `charge.dispute.created` is already implemented and the live endpoint’s event
  subscription was previously verified.
- Apple Developer/App Store Connect: MFA, membership review, signing
  certificate/profile recovery.
- Google Play and Google Cloud: MFA and membership review; vault/restrict the
  Play service-account key; apply Android/iOS/app/API restrictions to
  Places/Maps keys and close the two key alerts.
- Expo/EAS: MFA, session/token audit, then export signing credentials to the
  offline vault.
- Founder Google account: hardware security key or Advanced Protection; remove
  SMS recovery where a stronger path exists; audit OAuth grants and forwarding.
- OpenAI and Gemini: provider-side hard spend caps and billing alerts, separate
  from in-app quotas.
- Resend: MFA, verified-domain review, send-only key, rotation exercise.
- Supabase, Vercel, Namecheap, and Cloudflare: hardware-backed MFA, member/token
  review, and a recovery email independent of `twoferapp.com`.

## GitHub, Vercel, DNS, and email

- The timestamped public-DNS snapshot is
  `docs/security/dns-email-posture-snapshot-2026-07-29.json`: no DS/DNSKEY is
  published and DMARC remains `p=none`.
- Decide public/private repository visibility. Privacy does not erase Git
  history.
- Protect `main`, including administrators: no force-push/deletion, reviewed
  PRs, unique required CI/secret-scan/CodeQL checks. GitHub documents these
  controls here:
  https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- Replace classic tokens with fine-grained/hardware-backed access. Activate the
  encrypted off-GitHub repository mirror after the separate backup account
  exists.
- Require Vercel manual production promotion and alerts on deployment, domain,
  environment-variable, token, and member changes.
- Put `admin.twoferapp.com` behind Cloudflare Access for the founder identity,
  then set the website/API origin and test the sealed cookie flow there.
- Verify registrar auto-renew and backup payment. Enable Cloudflare DNSSEC and
  publish the returned DS record at the registrar:
  https://developers.cloudflare.com/registrar/get-started/enable-dnssec/
- Review DMARC reports and every legitimate SPF/DKIM sender before moving
  `p=none` to `quarantine`, then `reject`:
  https://developers.cloudflare.com/dmarc-management/

Each DNS/DMARC step is separately approved and observed before the next.

## Developer machine and local secrets

The automated BitLocker query was denied without elevation. Run an elevated
`manage-bde -status C:` and require `Protection Status: Protection On`.

The filename-only sweep found local `.env` files, four Android keystore copies,
an upload certificate, and Supabase/website env files. It also confirmed
`google-services.json` is tracked; that file commonly contains client
identifiers rather than a server secret, but its Google API key restrictions
must be verified. Do not delete or rotate signing files blindly:

1. Identify the currently active Android keystore by certificate fingerprint.
2. Back it up encrypted with its alias/password and Play recovery instructions.
3. Verify the backup before retiring redundant `OLD` copies.
4. Move required env values to the password manager/offline vault and minimize
   plaintext copies.
5. Inventory GitHub/EAS sessions and adb keys; revoke stale sessions/tokens.
6. Disable browser password storage for founder/provider accounts.

## Backend portability

The paid `api.twoferapp.com` Supabase custom-domain change is deferred under
the zero-added-cost bootstrap policy. If revenue later justifies it, it remains
a store-release project. It changes Auth/OAuth behavior and requires callback,
Storage, Function, Google, and Apple sign-in tests. Supabase’s preparation and
activation requirements are here:
https://supabase.com/docs/guides/platform/custom-domains

Do not activate it until the app and website can use it and the attach-to-a-new
project recovery drill passes.

## Incident order

When takeover is suspected:

1. Preserve evidence and use a known-clean device/network.
2. Revoke application/provider sessions first, beginning with founder email,
   Supabase, GitHub, Vercel, Stripe, Cloudflare/registrar, Apple, Google, and EAS.
3. Rotate exposed runtime keys and passwords; deploy replacements from a known
   reviewed SHA.
4. Revoke old personal/API/CI tokens and inspect audit logs, forwarding rules,
   OAuth grants, webhook destinations, payout settings, DNS, and releases.
5. Correct DNS only after registrar/Cloudflare control is secured.
6. Validate database, Storage, Auth, billing, signing, and deployed-SHA
   integrity. Restore only from a verified immutable backup if integrity cannot
   be established.
7. Notify affected users/regulators according to counsel and the privacy
   incident process; record the timeline and improve this runbook.

The recovery exercise is complete only when another operator can follow the
vault and runbooks to recover a disposable environment within the measured RTO.

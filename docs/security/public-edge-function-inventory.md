# Edge-function public-surface inventory

Generated from `supabase/config.toml` and function source by
`node scripts/security/generate-security-inventories.mjs`.

“Public” here means the Supabase gateway does not validate a JWT. It does not
mean the function is unauthenticated: most functions validate a user JWT,
provider signature, cron secret, or capability token in their own code.

Current count: **78** functions with `verify_jwt = false`.

| Function | In-function authorization | Abuse protection detected |
|---|---|---|
| `claim-deal` | user JWT checked in-function | single-use/expiry; idempotency/dedupe; authenticated caller |
| `redeem-token` | user JWT checked in-function | single-use/expiry; idempotency/dedupe; authenticated caller |
| `release-claim` | user JWT checked in-function | single-use/expiry; authenticated caller |
| `wallet-pass-issue` | user JWT checked in-function | authenticated caller |
| `wallet-pass-webservice` | Apple Wallet signed device/pass token | signed/scoped capability checked in-function |
| `activate-redemption-mode` | user JWT checked in-function | authenticated caller |
| `exit-redemption-mode` | device exit token + owner PIN, checked in-function | signed/scoped capability checked in-function |
| `staff-redemption` | user JWT checked in-function | single-use/expiry; authenticated caller |
| `manage-redemption-devices` | user JWT checked in-function | authenticated caller |
| `owner-redemption-security` | user JWT checked in-function | authenticated caller |
| `ai-create-deal` | retired operation; always returns HTTP 410 | no state-changing path |
| `ai-generate-deal-copy` | user JWT checked in-function | authenticated caller |
| `ai-generate-ad-variants` | user JWT checked in-function | idempotency/dedupe; authenticated caller |
| `ai-compose-offer` | user JWT checked in-function | single-use/expiry; idempotency/dedupe; authenticated caller |
| `ai-extract-menu` | user JWT checked in-function | authenticated caller |
| `delete-user-account` | user JWT checked in-function | application/DB rate limit; authenticated caller |
| `ingest-analytics-event` | optional user JWT; four pre-auth event names deliberately public | single-use/expiry; idempotency/dedupe; authenticated caller; daily-HMAC IP actor key; atomic 60/actor + 5,000 global per 15 minutes |
| `publish-offer-version` | user JWT checked in-function | single-use/expiry; idempotency/dedupe; authenticated caller |
| `weekly-deal-digest` | x-cron-secret | cron secret |
| `send-trial-ending-reminders` | x-cron-secret | idempotency/dedupe; cron secret |
| `expire-billing-access` | x-cron-secret | single-use/expiry; idempotency/dedupe; cron secret |
| `begin-visual-redeem` | user JWT checked in-function | single-use/expiry; authenticated caller |
| `complete-visual-redeem` | user JWT checked in-function | single-use/expiry; authenticated caller |
| `cancel-visual-redeem` | retired operation; always returns CANCEL_NOT_SUPPORTED | no state-changing path |
| `finalize-stale-redeems` | x-cron-secret | single-use/expiry; cron secret |
| `deal-link` | deliberately public; signed/share identifier is validated in-function | signed/scoped capability checked in-function |
| `qr-campaign-redirect` | deliberately public redirect; campaign slug is the capability | atomic 30/IP + 2,000/campaign per minute DB ceiling |
| `deal-share-lookup` | deliberately public; share code is validated in-function | application/DB rate limit; single-use/expiry |
| `submit-business-application` | deliberately public intake | application/DB rate limit; honeypot |
| `submit-launch-signup` | deliberately public intake | application/DB rate limit; honeypot; idempotency/dedupe |
| `admin-dashboard-summary` | user JWT checked in-function + active admin/role/MFA guard | single-use/expiry; idempotency/dedupe; authenticated caller |
| `admin-qr-campaigns` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |
| `admin-auth-session` | founder credentials/refresh token + active owner UUID + mandatory TOTP | application/DB rate limit; 8 failed password attempts/email/15 minutes |
| `admin-ai-usage` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |
| `admin-business-applications` | user JWT checked in-function + active admin/role/MFA guard | single-use/expiry; idempotency/dedupe; authenticated caller |
| `public-local-businesses` | deliberately public read-only directory | read-only operation with bounded query/result |
| `request-business-on-twofer` | user JWT checked in-function | authenticated caller |
| `admin-prospect-import` | user JWT checked in-function + active admin/role/MFA guard | idempotency/dedupe; authenticated caller |
| `admin-prospect-enrich` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; authenticated caller |
| `admin-prospect-score` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; idempotency/dedupe; authenticated caller |
| `admin-demand-proof` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; authenticated caller |
| `admin-sales-script` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; authenticated caller |
| `admin-onboarding-review-ai` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; idempotency/dedupe; authenticated caller |
| `admin-prospect-sales` | user JWT checked in-function + active admin/role/MFA guard | idempotency/dedupe; authenticated caller |
| `admin-claim-link-create` | user JWT checked in-function + active admin/role/MFA guard | single-use/expiry; authenticated caller |
| `admin-claim-link-assistant` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; authenticated caller |
| `business-claim-link` | signed single-use claim token | single-use/expiry; signed/scoped capability checked in-function |
| `business-checkout-link` | signed single-use checkout token | application/DB rate limit; single-use/expiry; signed/scoped capability checked in-function |
| `admin-trial-create-from-prospect` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |
| `admin-trial-conversion-assistant` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; single-use/expiry; authenticated caller |
| `admin-ai-operating-report` | user JWT checked in-function + active admin/role/MFA guard | application/DB rate limit; single-use/expiry; authenticated caller |
| `admin-ai-cost-ledger-reset` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |
| `admin-ai-prompts` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |
| `get-business-onboarding-context` | signed onboarding token or user JWT, checked in-function | single-use/expiry; idempotency/dedupe; authenticated caller; signed/scoped capability checked in-function |
| `update-business-profile-section` | user JWT checked in-function | authenticated caller |
| `accept-business-terms` | user JWT checked in-function | authenticated caller |
| `send-deal-push` | x-cron-secret | idempotency/dedupe; cron secret |
| `ai-business-lookup` | user JWT checked in-function | application/DB rate limit; authenticated caller |
| `ai-deal-suggestions` | user JWT checked in-function | authenticated caller |
| `ai-translate-deal` | user JWT checked in-function | authenticated caller |
| `billing-pricing` | deliberately public read-only pricing | read-only operation with bounded query/result |
| `billing-checkout-redirect` | signed checkout token | signed/scoped capability checked in-function |
| `simulate-subscribe` | retired operation; always returns HTTP 410 | no state-changing path |
| `stripe-create-checkout-session` | user JWT checked in-function | single-use/expiry; authenticated caller |
| `business-activation-status` | signed activation token | single-use/expiry; signed/scoped capability checked in-function |
| `stripe-customer-portal-session` | user JWT checked in-function | single-use/expiry; authenticated caller |
| `stripe-ensure-customer` | user JWT checked in-function | authenticated caller |
| `stripe-backfill-customers` | x-cron-secret or privileged user JWT, checked in-function | authenticated caller |
| `stripe-expire-pending-checkout` | x-cron-secret | cron secret |
| `stripe-cancel-trial-subscription` | user JWT checked in-function | authenticated caller |
| `stripe-cancel-paid-subscription` | user JWT checked in-function | authenticated caller |
| `stripe-request-introductory-refund` | user JWT checked in-function | idempotency/dedupe; authenticated caller |
| `stripe-webhook` | Stripe-Signature verified with the webhook signing secret | single-use/expiry; idempotency/dedupe; signed provider request + event dedupe |
| `import-business-website` | user JWT checked in-function | application/DB rate limit; authenticated caller |
| `set-promo-materials-authorization` | user JWT checked in-function | authenticated caller |
| `admin-promo-authorization` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |
| `admin-account-management` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |
| `admin-owner-email` | user JWT checked in-function + active admin/role/MFA guard | authenticated caller |

## Required review

- `ingest-analytics-event` and `qr-campaign-redirect` are anonymous-write
  surfaces and must retain a flood/cost ceiling independent of attacker-chosen
  identifiers.
- Any row saying “manual review required” is a release blocker until its intended
  public contract and abuse ceiling are documented or implemented.
- Regenerate this file whenever `supabase/config.toml` or an Edge Function auth
  boundary changes.

# Generated release state

**Do not hand-edit.** Regenerate with `node scripts/generate-release-state.mjs`.
CI drift gate: `node scripts/generate-release-state.mjs --check`.
Docs should link here instead of restating these facts (audit F-012).

## App

- Version: `1.0.0`
- Android versionCode: `49`
- iOS buildNumber (app.json): `not set in app.json (managed via EAS)`
- Android package: `com.unvmex2.twoforone`
- iOS bundle id: `com.unvmex2.twoforone`
- Expo SDK: `~54.0.35`, React Native: `0.81.5`

## Billing flags (lib/billing/access.ts)

- PAID_BILLING_ENABLED: `true`
- PILOT_DISABLE_BILLING_GATE: `false`

## EAS build env flags (eas.json)

- **preview**
  - EXPO_PUBLIC_ENABLE_SHARE_DEAL: `true`
  - EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS: `true`
  - EXPO_PUBLIC_ENABLE_MOBILE_BILLING_LINKS: `false`
- **production**
  - EXPO_PUBLIC_ENABLE_SHARE_DEAL: `true`
  - EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS: `true`
  - EXPO_PUBLIC_ENABLE_MOBILE_BILLING_LINKS: `false`
  - EXPO_PUBLIC_AI_V5_AUTOMATIC_VERIFIED_BUNDLE_APPROVAL_ENABLED: `false`
- **dev-client-apk**
  - EXPO_PUBLIC_ENABLE_SHARE_DEAL: `true`
  - EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS: `true`
- **dev-apk-ai-studio**
  - EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING: `true`

## Database migrations (supabase/migrations)

- Count: `145`
- Latest: `20260817120000_approved_not_activated_activation_gate.sql`

## Edge Functions (supabase/functions, 77 local)

- accept-business-terms
- activate-redemption-mode
- admin-ai-cost-ledger-reset
- admin-ai-operating-report
- admin-ai-prompts
- admin-ai-usage
- admin-auth-session
- admin-business-applications
- admin-business-name-requests
- admin-claim-link-assistant
- admin-claim-link-create
- admin-dashboard-summary
- admin-demand-proof
- admin-onboarding-review-ai
- admin-prospect-enrich
- admin-prospect-import
- admin-prospect-sales
- admin-prospect-score
- admin-qr-campaigns
- admin-reports
- admin-sales-script
- admin-trial-conversion-assistant
- admin-trial-create-from-prospect
- ai-business-lookup
- ai-compose-offer
- ai-create-deal
- ai-deal-suggestions
- ai-extract-menu
- ai-generate-ad-variants
- ai-generate-deal-copy
- ai-studio-generate-draft
- ai-translate-deal
- begin-visual-redeem
- billing-checkout-redirect
- billing-pricing
- business-activation-status
- business-checkout-link
- business-claim-link
- cancel-visual-redeem
- claim-deal
- complete-visual-redeem
- deal-link
- deal-share-lookup
- delete-user-account
- exit-redemption-mode
- expire-billing-access
- finalize-stale-redeems
- get-business-onboarding-context
- import-business-website
- ingest-analytics-event
- manage-redemption-devices
- owner-redemption-security
- public-local-businesses
- publish-offer-version
- qr-campaign-redirect
- redeem-token
- release-claim
- request-business-on-twofer
- send-deal-push
- send-trial-ending-reminders
- simulate-subscribe
- staff-redemption
- stripe-backfill-customers
- stripe-cancel-paid-subscription
- stripe-cancel-trial-subscription
- stripe-create-checkout-session
- stripe-customer-portal-session
- stripe-ensure-customer
- stripe-expire-pending-checkout
- stripe-request-introductory-refund
- stripe-webhook
- submit-business-application
- submit-launch-signup
- update-business-profile-section
- wallet-pass-issue
- wallet-pass-webservice
- weekly-deal-digest

## Hosted comparison (requires credentials — run separately)

- Migrations: `supabase migration list --linked` must show every local file applied and nothing extra.
- Functions: `supabase functions list` must equal the local list above. A remote-only function is drift
  (e.g. `ai-refine-ad-copy`, flagged by audit F-013 — see docs/full-system-audit/24_ai_refine_ad_copy_disposition.md).

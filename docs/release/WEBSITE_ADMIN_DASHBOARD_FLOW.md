# Website Admin Dashboard Foundation

Date: 2026-07-01

## Scope

This adds the local foundation for an internal, web-only Twofer admin dashboard at `/admin`.

The dashboard is not a merchant-facing mobile surface. Stripe billing, portal, and future checkout actions remain web/admin/server-only. The mobile app must continue to show neutral account-state copy and must not add subscription purchase, external billing links, Apple Pay, or Google Pay.

## Routes Added

- `/admin`
- `/admin/login`
- `/admin/businesses`
- `/admin/businesses/new`
- `/admin/businesses/[businessId]`
- `/admin/trial-requests`
- `/admin/offers`
- `/admin/billing/events`
- `/admin/audit-log`
- `/admin/settings`

## Backend Added

- `supabase/migrations/20260730125000_admin_dashboard_foundation.sql`
- `supabase/migrations/20260730126000_website_app_onboarding_sync.sql`
- `supabase/migrations/20260730128000_admin_ai_quota_resets.sql`
- `supabase/migrations/20260730129000_admin_onboarding_service_role_invite_gate.sql`
- `supabase/migrations/20260802142000_admin_redemption_facts_view.sql`
- `supabase/functions/admin-auth-session/index.ts`
- `supabase/functions/admin-dashboard-summary/index.ts`
- `supabase/functions/admin-ai-usage/index.ts`
- `supabase/functions/admin-business-applications/index.ts`
- `supabase/functions/get-business-onboarding-context/index.ts`
- `supabase/functions/update-business-profile-section/index.ts`

The migration adds:

- `admin_users`
- `admin_audit_log`
- `admin_notes`
- `launch_areas`
- `feature_flags`
- `system_events`
- business status/access/verification fields
- `can_business_publish(business_id)`
- onboarding field-source/revision/checklist/terms tables for website-to-app review
- service-role allowance for reviewed admin/app onboarding materialization while client signups remain invite-gated

The Edge Function:

- Authenticates a Supabase user from the JWT.
- Checks the user is active in `admin_users`.
- Reads current dashboard, AI spend, quota, and trial request metrics from existing tables.
- Uses `business_subscriptions` first, with legacy `location_entitlements` fallback where required.
- Writes admin login, dashboard, AI usage/reset, and business application decision audit rows.
- Does not depend on Stripe, OpenAI, or Google provider secrets.

The Trial Requests page now has a live server-backed admin workflow for list, limited approval, full approval, waitlist, and reject decisions. Business detail pages still include placeholders for onboarding source, website submitted data, current app profile, field source/last edited state, sensitive changes needing review, AI suggestions, and owner app activity; those deeper business-detail actions still need audited admin Edge Functions before production use.

## Redemption Reporting Note

Admin redemption reporting should use `public.admin_redemption_facts_v1` as the canonical read-only source for redeemed deals. The view is backed by `public.deal_claims` and includes only rows where `redeemed_at IS NOT NULL` and `claim_status = 'redeemed'`. Do not use the `redemptions` table for North Star counts yet; it is a staff Redemption Mode audit table and does not cover every redemption path.

## Deployment Notes

No hosted migration or Edge Function deployment is performed by committing these files. Applying `20260730125000_admin_dashboard_foundation.sql`, `20260730126000_website_app_onboarding_sync.sql`, `20260730129000_admin_onboarding_service_role_invite_gate.sql`, or `20260802142000_admin_redemption_facts_view.sql`, deploying any Edge Function, and deploying `website/` are production-changing operations and require explicit approval.

# Website Business Onboarding Flow

Date: 2026-07-01
Updated: 2026-07-13

## Flow

1. Business visits `https://www.twoferapp.com/business/start-trial`; the backwards-compatible `/business` page redirects to the same canonical form.
2. Business submits a reviewed DFW trial request.
3. `submit-business-application` validates the payload, enforces the honeypot, applies deterministic risk routing, inserts `business_applications`, and saves a normalized `business_onboarding_requests` record for app/admin sync.
4. Low-risk DFW businesses remain `pending_review` / `pending_verification`; unclear applications become `review_required` or `pending_verification`; outside-launch applications become `waitlisted`; prohibited signals become `rejected`.
5. If the low-risk request has no exact duplicate and `ADMIN_ALERT_EMAIL` maps to an active decision-capable admin, the admin alert includes a single-use 30-minute quick-approval link. Opening the link only shows a minimal preview; Dan must press the confirmation button before the existing full 30-day trial decision path runs.
6. Requests without an eligible quick link, and all full-trial or non-approval decisions, stay in the signed-in admin Trial Requests workflow.
7. Approved businesses are activated through admin/web billing or manual entitlement state.
8. Business owner logs into the app with the same email.
9. `get-business-onboarding-context` links or materializes the canonical `businesses` row and returns app-safe imported profile data.
10. The owner reviews/edits the imported details in the app through `update-business-profile-section`.
11. Mobile app publishing remains gated by `can_business_publish`; no AI draft auto-publishes.

## Local Files Added

- `website/business/index.html`
- `website/business/start-trial/index.html`
- `website/business/waitlist/index.html`
- `website/business/review-pending/index.html`
- `website/business/thanks/index.html`
- `website/delete-account/index.html`
- `supabase/migrations/20260730123000_business_applications.sql`
- `supabase/migrations/20260730124000_business_onboarding_workflow.sql`
- `supabase/migrations/20260730126000_website_app_onboarding_sync.sql`
- `supabase/migrations/20260730129000_admin_onboarding_service_role_invite_gate.sql`
- `supabase/migrations/20260815120000_admin_email_quick_approval.sql`
- `supabase/functions/submit-business-application/index.ts`
- `supabase/functions/admin-business-applications/index.ts`
- `supabase/functions/_shared/admin-quick-approval.ts`
- `supabase/functions/get-business-onboarding-context/index.ts`
- `supabase/functions/update-business-profile-section/index.ts`
- `website/quick-approve-trial/index.html`
- `website/quick-approve-trial/quick-approve.js`

## Business Applications Table

Fields:

- `business_name`
- `contact_name`
- `email`
- `phone`
- `address`
- `business_type`
- `website_or_instagram`
- `slow_hours`
- `offer_interests`
- `launch_area`
- `terms_accepted`
- `privacy_acknowledged`
- `status`
- `source`
- `access_tier`
- `verification_status`
- `risk_score`
- `risk_reasons`
- trial limit fields
- field invite placeholders
- `admin_notes`
- `business_id`
- `onboarding_request_id`

RLS posture: table is RLS-enabled and client roles have no direct access. Public submissions go through the Edge Function.

## App Sync Tables

The shared onboarding pipeline adds:

- `business_onboarding_requests`
- `business_members`
- `business_contact_channels`
- `business_slow_hours`
- `business_promotable_items`
- `business_profile_field_sources`
- `business_profile_revision_log`
- `business_setup_checklist`
- `terms_acceptances`

Business users receive safe projections through Edge Functions. Admin-only risk notes, raw request payloads, and billing/Stripe details are not returned to the mobile app. Trial request decisions are handled server-side by `admin-business-applications`, which checks `admin_users` and writes audit rows before changing application, business, or subscription access state.

## Deployment Notes

After Dan approved the Supabase production steps, `20260730123000_business_applications.sql` was applied and `submit-business-application` was deployed to project `kvodhiqhdqnptqovovia`.
After Dan approved website deployment, `website/` was deployed to the existing Vercel project `v0-twofer-landing-page` and aliased to `https://www.twoferapp.com`.

Android App Links are enabled in `assetlinks.json` with the Google Play App Signing SHA-256.

On 2026-07-01, a clearly marked non-sensitive Twofer QA business access request was submitted through the hosted Edge Function and returned `200 {"ok":true}`. That validates the production insert path without using real merchant data.

The admin onboarding invite-gate migration, admin trial request function, and new app-facing Edge Functions are local files only until Dan explicitly approves applying/deploying them.

The email quick-approval migration, shared function changes, and confirmation page are also local only as of 2026-07-13. Rollout order is the database migration, the `submit-business-application` and `admin-business-applications` Edge Functions, and then the website. Each hosted step remains approval-gated.

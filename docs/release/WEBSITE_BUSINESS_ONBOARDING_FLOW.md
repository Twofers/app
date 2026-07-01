# Website Business Onboarding Flow

Date: 2026-07-01

## Flow

1. Business visits `https://www.twoferapp.com/business`.
2. Business submits a reviewed access request.
3. `submit-business-application` validates the payload, enforces the honeypot, and inserts `business_applications`.
4. Dan reviews the application outside the mobile app.
5. Approved businesses are activated through admin/web billing or manual entitlement state.
6. Business owner logs into the app.
7. Mobile app unlocks merchant tools only when Supabase entitlement status is active/trial-active.

## Local Files Added

- `website/business/index.html`
- `website/business/thanks/index.html`
- `website/delete-account/index.html`
- `supabase/migrations/20260730123000_business_applications.sql`
- `supabase/functions/submit-business-application/index.ts`

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
- `admin_notes`

RLS posture: table is RLS-enabled and client roles have no direct access. Public submissions go through the Edge Function.

## Deployment Notes

After Dan approved the Supabase production steps, `20260730123000_business_applications.sql` was applied and `submit-business-application` was deployed to project `kvodhiqhdqnptqovovia`.
After Dan approved website deployment, `website/` was deployed to the existing Vercel project `v0-twofer-landing-page` and aliased to `https://www.twoferapp.com`.

Android App Links are enabled in `assetlinks.json` with the Google Play App Signing SHA-256.

On 2026-07-01, a clearly marked non-sensitive Twofer QA business access request was submitted through the hosted Edge Function and returned `200 {"ok":true}`. That validates the production insert path without using real merchant data.

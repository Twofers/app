# App Store Submission Implementation Report

Date: 2026-07-01

## Plan Validation

The implementation plan is directionally valid for the selected launch posture: consumers are free, merchant billing remains web/admin-side, and the iOS/Android mobile app must not expose Stripe Checkout, pricing, subscription CTAs, or external payment routing.

Initial implementation did not perform hard-gated operations. After Dan approved the production steps, `20260730123000_business_applications.sql` was applied, `submit-business-application` was deployed to project `kvodhiqhdqnptqovovia`, and `website/` was deployed to the existing Vercel project `v0-twofer-landing-page`. No release build, App Store submission, push, tag, merge, or secret change was performed.

## Repo State

- Branch: `release/apple-app-store-readiness-web-billing`
- Base commit: `c6e10585`
- App version: `1.0.0`
- iOS bundle ID: `com.unvmex2.twoforone`
- Android package: `com.unvmex2.twoforone`
- Android versionCode in code: `38`
- Expo CLI: `54.0.25`
- Node: `v25.5.0`
- npm: `11.5.2`

Conflict noted: older current-state docs say Android `versionCode` 31, but `app.json` currently contains 38. Code wins. The pre-existing dirty `app.json` and `android/app/build.gradle` changes were preserved.

## Completed Work

- Added fail-closed mobile billing flags:
  - `EXPO_PUBLIC_ENABLE_MOBILE_STRIPE=false`
  - `EXPO_PUBLIC_ENABLE_MOBILE_SUBSCRIPTION_CTA=false`
  - `EXPO_PUBLIC_ENABLE_BUSINESS_SELF_SERVE_MOBILE=false`
  - `EXPO_PUBLIC_ENABLE_MOBILE_PRICING_PAGE=false`
  - `EXPO_PUBLIC_ENABLE_MOBILE_BILLING_LINKS=false`
- Gated billing routes, legacy billing redirects, billing deep links, Stripe Checkout launch, and Stripe customer portal launch behind dev-only explicit mobile billing flags.
- Added central merchant access helper based on Supabase location entitlement status.
- Redirected inactive merchant tool access to Account and showed neutral support language instead of payment language.
- Changed deal detail reporting from "Report this business" to "Report this offer" while reusing the existing report RPC with deal context.
- Added a mobile store-copy guard script and package command: `npm run check:mobile-store-copy`.
- Added and deployed the Supabase business application migration and `submit-business-application` Edge Function after approval.
- Added static website pages for home, business access request, thanks, support, privacy, terms, business terms, delete account, share fallback, AASA, and Android asset links.
- Updated release docs, privacy draft, metadata draft, screenshot plan, manual checklist, risk register, web-only Stripe decision, and website onboarding flow.

## Mobile Billing Exposure

Before:

- `app/(tabs)/account/billing.tsx` could call `stripe-create-checkout-session`.
- `app/(tabs)/account/billing/manage.tsx` could call `stripe-customer-portal-session`.
- Account/Create/Dashboard could direct blocked merchants toward billing UI.

After:

- Mobile billing defaults to disabled and requires all five explicit flags plus dev runtime.
- Production and preview EAS profiles explicitly set all mobile billing flags to `false`.
- Billing routes redirect to Account when disabled.
- Billing deep links are ignored when disabled.
- Blocked merchant access shows: "Your business account is not active. Contact Twofer support to activate your business account."

## Backend / Website

- Applied additive migration: `20260730123000_business_applications.sql`.
- Deployed Edge Function: `submit-business-application`.
- Hosted checks passed for CORS preflight, missing-required-fields validation, and honeypot success without inserting a real application.
- Website source includes `/delete-account`, static-host `_headers`, `_redirects`, and Vercel rewrites/headers for `/s/*` share-link fallback routing.
- Website deployed to `https://www.twoferapp.com`; latest production Vercel deployment after legal/privacy copy review is `dpl_BokuXrXscJigCTKt7MPXHZKxKCv9`.
- AASA now uses the live-confirmed Apple Team ID `L9DT756YSN`.
- `assetlinks.json` now enables Android App Links for `com.unvmex2.twoforone` with the Google Play App Signing SHA-256.

## Validation

- `npm run lint -- --max-warnings=0`: pass
- `npm run typecheck -- --pretty false`: pass
- `npx tsc --noEmit --pretty false`: pass
- `npm test`: pass, 203 files / 1089 tests
- `npm run check:mobile-store-copy`: pass
- `npm run check:website-supabase`: pass
- `REQUIRE_SIGNED_ASSOCIATION_FILES=true npm run check:website-supabase`: pass
- `npx expo-doctor`: pass, 18/18
- `npx expo config --type public`: pass
- `deno check supabase/functions/submit-business-application/index.ts`: pass
- `npm run typecheck:functions`: pass, 77 Edge Function source files
- `npm run typecheck:functions -- --pretty false`: pass, 77 Edge Function source files
- `node scripts/probe-rls-smoke.mjs`: pass after applying `20260730123000_business_applications.sql`
- Website static route/JSON check: pass
- Hosted website verification: `/`, `/business/`, `/business/thanks/`, `/business-terms/`, `/delete-account/`, `/privacy/`, `/support/`, `/terms/`, `/s/`, `/s/ABCDEFG`, AASA, assetlinks, and `/styles.css` returned 200 on `https://www.twoferapp.com`.
- Live legal/privacy review: pass. Public privacy, terms, business terms, support, and delete-account pages are live and match the no-mobile-checkout launch posture.
- Production business application smoke: pass. A clearly marked non-sensitive Twofer QA business access request returned `200 {"ok":true}` from `submit-business-application`.

## Remaining Manual Tasks

- Add real App Review consumer and merchant demo credentials in App Store Connect only.
- Verify seeded reviewer data in hosted Supabase.
- Configure `gettwofer.com` redirects to `https://www.twoferapp.com`.
- Build the final iOS app with the current Apple SDK requirement only after explicit approval.
- Submit the selected build for review only after explicit approval.

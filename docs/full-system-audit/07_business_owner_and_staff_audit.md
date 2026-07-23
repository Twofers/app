# Business owner and staff audit

## Business onboarding and approval

`app/business-setup.tsx:631-722` validates a shared invite and inserts a business. Later migration protections force server-owned approval/access fields into safe initial values (`supabase/migrations/20260804120000_lock_businesses_server_columns.sql:43-67`), but the invite is embedded in the client (F-003) and pending rows can still be publicly discovered (F-002).

Required invariant: only approved, active, verified businesses/locations can appear publicly, publish, claim, or redeem according to the documented lifecycle.

## Deal creation and publication

AI review/publish follows `publish-offer-version`, while compatibility edit directly updates `deals`. Owner RLS checks ownership but not full canonical eligibility (F-001). Client/Edge checks are not compensating controls against direct PostgREST.

## Billing and terms

Terms acceptance and verification checks exist in the official publish function. A richer `can_business_publish` helper exists, but final direct-write policies do not enforce it. Code has paid billing enabled and pilot billing bypass false, conflicting with stale docs. Checkout/session issues are detailed in the Stripe audit.

## Staff/redemption

Separate staff, token, visual redeem, and device-management functions exist with redeemer-role helpers. Unauthenticated redeem failed closed. Dedicated owner/staff/device success, revoke, cross-business, concurrent, and offline tests remain blocked.

## Business usability risks

F-007 can block native reliability; F-008 adds website application friction; F-001/F-002 can undermine owner trust; F-005/F-006 can break payment/access. Store links and live-device flows remain release conditions.


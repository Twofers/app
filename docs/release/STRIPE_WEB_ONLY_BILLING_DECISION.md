# Stripe Web-Only Billing Decision

Date: 2026-07-01

## Decision

For initial public App Store launch, the mobile app does not sell merchant subscriptions, open Stripe Checkout, show pricing, or link users to external payment pages. Stripe remains available for approved web/admin billing and backend subscription-status sync.

## Code Classification

| File | Code path | Current behavior | Keep, gate, move, or remove | Reason |
|---|---|---|---|---|
| `lib/billing/access.ts` | Mobile billing flags | Defaults false; dev-only explicit enable | Gate | Production mobile must fail closed |
| `app/(tabs)/account/billing.tsx` | Stripe Checkout | Redirects to Account unless dev flags enabled | Gate | Prevent mobile checkout |
| `app/(tabs)/account/billing/manage.tsx` | Stripe portal/cancel/refund | Redirects to Account unless dev flags enabled | Gate | Prevent mobile billing links |
| `components/billing-deeplink-handler.tsx` | Checkout return links | Ignored unless dev flags enabled | Gate | Prevent old links reopening billing |
| `app/(tabs)/billing*.tsx` | Legacy billing routes | Redirects to Account unless dev flags enabled | Gate | Prevent old route access |
| `supabase/functions/stripe-*` | Backend Stripe functions | Kept | Keep | Web/admin billing and sync still needed |
| `supabase/functions/stripe-webhook` | Stripe event sync | Kept | Keep | Merchant status authority depends on backend status |
| `website/business` | Public business request | No checkout; reviewed request only | Keep | Approved onboarding path |
| `website/business-terms` | Billing terms | Describes web/admin billing only | Keep | Public business/legal disclosure |

## Mobile Access Authority

Mobile merchant tools are controlled by Supabase entitlement status. Allowed statuses are:

- `trial_active`
- `admin_trial_active`
- `trial_canceling`
- `pro_active`
- `pro_canceling`
- `paid_active`
- `paid_canceling`

Inactive, eligible, pending, suspended, canceled, or unknown statuses are blocked with neutral support language.

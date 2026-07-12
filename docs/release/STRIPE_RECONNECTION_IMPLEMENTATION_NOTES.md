# Stripe Reconnection Implementation Notes

Date: 2026-07-01

## Summary

Stripe billing is reconnected as a web/admin/server flow. Mobile paid billing remains closed: the mobile billing routes redirect to Account, and `lib/billing/access.ts` returns `false` for mobile Stripe, pricing, portal, link, CTA, and paid billing gates.

## What changed

- Website/admin onboarding now seeds business billing profiles, subscription rows, and Stripe customer sync jobs.
- `submit-business-application` can create or update a Stripe Customer only when a canonical business owner exists; otherwise it queues a sync job for later materialization.
- `get-business-onboarding-context` queues sync after app login materialization without importing Stripe or reading `STRIPE_SECRET_KEY`.
- Business-level Checkout and Customer Portal are scoped by `business_id`, admin/member authorization, and optional single-use billing tokens.
- Stripe webhooks sync `business_subscriptions`, `business_billing_profiles`, `billing_events`, checkout sessions, and payment-failure reminders while preserving the legacy location-entitlement/refund path.
- Website billing return pages were added using existing site structure and styles.
- The optional `/business/billing/add-payment-method/` route exists as a disabled-by-default web page; no saved-card capture is enabled until a separate approved Stripe setup-mode flow is built.

## Not done here

- No Supabase migration was applied.
- No Edge Function was deployed.
- No Stripe secret was set or printed.
- No mobile payment CTA, Checkout, Customer Portal, external payment link, or saved-card capture was added.

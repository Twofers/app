# Stripe Web/Admin Billing Setup

This repo keeps merchant payments out of the mobile app. Stripe is used from the website/admin/server side only, and Stripe webhook events are the source of truth for business subscription state.

Do not run hosted Stripe setup, set secrets, apply migrations, or deploy functions without explicit approval.

## Required local code pieces

- Database: `20260730127000_stripe_business_billing_reconnection.sql`
- Checkout: `supabase/functions/stripe-create-checkout-session`
- Portal: `supabase/functions/stripe-customer-portal-session`
- Customer sync: `supabase/functions/stripe-ensure-customer`
- Controlled backfill: `supabase/functions/stripe-backfill-customers`
- Webhook: `supabase/functions/stripe-webhook`
- Website billing pages: `/business/billing/start/`, `/business/billing/success/`, `/business/billing/cancel/`, `/business/billing/manage/`, `/business/billing/add-payment-method/`, `/business/billing/status/`

## Secret names

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_TWOFER_PRO_MONTHLY` or `STRIPE_TWOFER_BUSINESS_PRICE_ID` when runtime billing config does not provide a price id
- `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID` if a custom portal configuration is required
- `ENABLE_STRIPE_BACKFILL=true` only for approved write-mode backfills
- `PAST_DUE_GRACE_DAYS` if the default 3-day grace window should change
- `SITE_URL` if the default `https://www.twoferapp.com` website URL should change

## Webhook events

Subscribe the hosted webhook endpoint to Checkout, customer, subscription, invoice, payment-failure, and refund events used by the billing functions. The webhook keeps the legacy location-entitlement path for older billing records and syncs new business-level records through `business_subscriptions`, `business_billing_profiles`, and `billing_events`.

## QA before live billing

- Run `npm run check:website-supabase`, `npm run typecheck:functions`, `npm run typecheck`, `npm run lint`, and `npm test`.
- In Stripe test mode, confirm Checkout success, Checkout cancel, portal open/return, invoice paid, invoice payment failed, subscription canceled, and refund handling.
- Confirm mobile billing routes redirect to Account and do not open Checkout, Customer Portal, or external payment pages.

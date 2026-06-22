# Twofer Billing Remaining Work

Updated: 2026-06-22

This file tracks what remains after the billing implementation branch was migrated and the Edge Functions were deployed to the linked Supabase project.

## Completed

- Billing migrations were applied to Supabase project `kvodhiqhdqnptqovovia`.
- Edge Functions were deployed to the same Supabase project.
- Configured Edge smoke check passed with `npm run gate:edges`.
- The billing implementation remains hidden from app users while `PAID_BILLING_ENABLED=false`.

## Validation still needed

### RLS smoke test

The required post-migration RLS smoke test is blocked until local throwaway shopper credentials are available in `.env`.

Required local-only variables:

```text
TWOFER_SMOKE_EMAIL=
TWOFER_SMOKE_PASSWORD=
```

After adding those values locally, run:

```bash
node scripts/probe-rls-smoke.mjs
```

Do not paste those credentials into chat, docs, commits, or terminal transcripts.

### Billing Edge smoke after Stripe setup

The generic Edge smoke currently reports `stripe-webhook` as unhealthy because the Stripe webhook signing secret is not configured yet. That is expected until the Stripe account exists and the Supabase secrets are set.

The HTML functions `billing-checkout-redirect` and `deal-link` return HTTP 200 by design, so they are not failures even if a generic JSON-auth smoke script flags them.

## Blocked until Stripe account exists

1. Create the Twofer Business subscription product in Stripe.
2. Create the monthly price for the product.
3. Configure the Stripe Customer Portal.
4. Configure the Stripe webhook endpoint:

```text
https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/stripe-webhook
```

5. Subscribe the webhook endpoint to the required billing events used by the app, including checkout, subscription, invoice, payment, and refund events.
6. Set Supabase Edge Function secrets for Stripe:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_WEBHOOK_SIGNING_SECRET
STRIPE_TWOFER_BUSINESS_PRICE_ID
STRIPE_PRICE_ID
STRIPE_EXPECTED_LIVEMODE
STRIPE_TAX_ENABLED
```

Use only the variables that match the chosen environment and rollout mode. `STRIPE_WEBHOOK_SECRET` is the preferred webhook secret name; `STRIPE_WEBHOOK_SIGNING_SECRET` is also accepted by `stripe-webhook`.

7. Confirm the billing runtime config points at the intended test or live price id.
8. Keep `BILLING_SIMULATE_SUBSCRIBE` absent or false for production-like testing.

## Billing QA still needed after Stripe setup

Run these in Stripe test mode before any paid rollout:

- Card-required Checkout trial creates the expected Stripe customer, subscription, and local billing entitlement.
- Admin-only no-card trial override grants access without opening public abuse paths.
- Checkout cancellation resets pending checkout state.
- Expired pending checkout is cleaned up safely.
- Trial cancellation cancels the Stripe subscription and updates local entitlement state.
- Paid subscription cancellation uses the paid cancellation path, not the trial cancellation path.
- Customer Portal opens only for the authenticated business owner and correct Stripe customer.
- Duplicate Stripe webhooks do not double-grant credits, double-update entitlement state, or create conflicting ledger rows.
- Failed webhook events can be retried safely.
- `$0` trial invoices do not grant paid deal credits.
- First paid invoice grants the intended paid deal credits exactly once.
- Subscription updates do not incorrectly grant new credits.
- Refund request flow records the Stripe refund identifiers and local request state.
- Failed payment and past-due states suspend publish/write actions for the affected location.
- Billing recovery restores publish/write actions only when entitlement state is active again.
- Trial-ending reminder cron sends only the intended reminder events.
- Deal-credit reservations expire and release correctly.
- Location-level billing keeps one location's billing state from affecting another location.

## App rollout gates

- Keep paid app surfaces hidden while `PAID_BILLING_ENABLED=false`.
- Do not enable purchase UI until Stripe test-mode QA passes.
- Do not enable live Stripe billing until test-mode Checkout, webhook, cancellation, refund, and failed-payment flows pass.
- Do not change version numbers, build numbers, bundle identifiers, signing, or release settings as part of billing setup.
- Do not claim the app is production or store ready until real-device QA and store submission tasks are complete.

## Remote cleanup decision

The remote Supabase project still has `ai-refine-ad-copy`, which is not present in the local `supabase/functions` directory. It was left untouched during the billing deploy.

Decision needed:

- Keep it if something outside the current app still calls it.
- Delete/prune it only after confirming it is unused.

## Non-billing work still outside this branch

- Website privacy policy still needs the public support email corrected to `support@twoferapp.com`.
- iOS TestFlight real-device pass is still required.
- Store screenshots from a real device are still required.
- App Store Connect and Play Console forms still need final human entry and review.
- Demo/reviewer account Supabase-side cleanup still needs to be completed according to the main handoff spec.

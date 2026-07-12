# Finding 07: Webhook business path skips price verification and has a permissive status fallback

Severity: Low
Surface: Stripe
Files:
- `supabase/functions/stripe-webhook/index.ts:643-655` (`businessAccessForStripeStatus` — permissive default)
- `supabase/functions/stripe-webhook/index.ts:669-808` (`syncBusinessSubscriptionFromStripe` — never calls `assertExpectedPrice`)
- `supabase/functions/stripe-webhook/index.ts:68-75` (`assertExpectedPrice`, used only in the location path)
Status: NOT STARTED

## What is wrong

Two small hardening gaps in the business billing path (the path that actually
runs for real self-serve checkouts, since `stripe-create-checkout-session` sets
`business_id` metadata):

1. **No price assertion.** `assertExpectedPrice` (which throws if the
   subscription's price id isn't the configured Twofer Business price) is called
   in `grantPaidPeriod` and `activateTrialFromCheckout` (the location path) but
   **not** in `syncBusinessSubscriptionFromStripe`. So the business path grants
   `active`/`trialing` access off whatever price the subscription carries.

2. **Permissive status fallback.** `businessAccessForStripeStatus` ends with:
   ```ts
   return cancelAtPeriodEnd
     ? { billingStatus: "active", appAccessStatus: "active" }
     : { billingStatus: "none", appAccessStatus: "pending" };
   ```
   For any Stripe status not explicitly enumerated, if `cancel_at_period_end` is
   true the function grants full `active` access. Unknown/edge statuses should
   not silently grant access.

Both are Low because a business cannot freely choose its own subscription price
(that goes through Twofer's checkout/portal), and the unknown-status-with-cancel
case is a narrow edge. But they weaken "access is granted only for the expected
paid product."

## Exploit or failure path

- Mostly a defense-in-depth gap rather than a direct exploit. If a subscription
  ever exists on an unexpected price (misconfiguration, a coupon/price swap, a
  reused customer with another product), the business path would grant access
  without noticing. The permissive fallback could grant `active` on a status
  Stripe adds in the future or an unusual state combined with
  `cancel_at_period_end`.

## The fix (spec)

1. In `syncBusinessSubscriptionFromStripe`, when a `subscription` is present and
   its status is `active`/`trialing`, call `assertExpectedPrice(config,
   subscription)` (load `config` via `loadRuntimeBillingConfig`) before writing
   `pro_active`/`trialing`. On mismatch, do not grant access — record the event
   as failed/skipped so it surfaces, matching how the location path already
   throws.
2. Change the `businessAccessForStripeStatus` default to fail closed: an
   unrecognized status should map to `appAccessStatus: "pending"` (no access)
   regardless of `cancel_at_period_end`. Keep the explicit branches
   (`active`, `trialing`, `past_due`/`unpaid`, `canceled`, `paused`,
   `incomplete*`) exactly as they are.

## How to verify

- Test-mode: drive a `customer.subscription.updated` with a price id different
  from the configured Twofer price and confirm the business is not granted
  `pro_active` (event recorded as failed/skipped).
- Unit-test `businessAccessForStripeStatus` with an unknown status +
  `cancel_at_period_end: true` and assert it returns `pending`, not `active`.
- Regression: normal `active` and `trialing` real-price events still grant
  access.

## Do NOT

- Do **not** add the price assertion in a way that throws on
  `canceled`/`deleted` events (their subscription may legitimately carry the old
  price, or `subscription` may be null) — only assert when you are about to
  *grant* access on `active`/`trialing`.
- Do **not** tighten the fallback so aggressively that a real `active`
  subscription with `cancel_at_period_end=true` (a paying customer who turned
  off auto-renew) loses access — that case is already handled by the explicit
  `status === "active"` branches above the fallback; leave those intact.

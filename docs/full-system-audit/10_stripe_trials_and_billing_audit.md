# Stripe, trials, and billing audit

## F-005 — Client-controlled Checkout selection (P1)

`supabase/functions/stripe-create-checkout-session/index.ts:29-33` allows a `test` source; `:230` reads it; `:257` exempts it from the purchase-surface gate; `:264` prioritizes request `price_id`; and `:322-340` sends that price to Stripe. An authenticated owner can therefore bypass the intended surface and select another price present in the account.

Webhook expected-price validation (`supabase/functions/stripe-webhook/index.ts:61-76`) is not compensating: it occurs after the customer may be charged and can turn the defect into “charged without entitlement.”

Fix by ignoring client environment/source/price authority and resolving an allowlisted product server-side. Any test/admin override must require verified admin authority and a non-live Stripe environment.

## F-006 — Non-atomic token use (P2)

`stripe-create-checkout-session/index.ts:143-162` reads `use_count`, checks a limit, then separately updates. Concurrent requests can both pass and create sessions. Consume with one conditional RPC/update and require exactly one returned row before calling Stripe.

## State and configuration

Webhook signature checks, expected-price validation, event/reconciliation records, portal, trial cancel, paid cancel, refund, customer backfill, and expiry flows exist. `PAID_BILLING_ENABLED` is true and the pilot bypass is false in `lib/billing/access.ts`; production EAS mobile billing UI flags are false. This channel split must be intentional and documented.

## Blocked verification

No live Checkout, token exchange, webhook, portal, cancellation, refund, tax, dispute, trial conversion, or subscription gating success path was run. These change financial/external state and require explicit approval plus dedicated Stripe test-mode identities.


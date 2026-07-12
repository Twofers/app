# Finding 03: Chargebacks (`charge.dispute.created`) do not revoke access

Severity: High
Surface: Stripe
Files:
- `supabase/functions/stripe-webhook/index.ts:92-94` (`isRefundWebhookEvent` — only `charge.refunded` / `refund.created`)
- `supabase/functions/stripe-webhook/index.ts:929-1105` (event dispatch — no `charge.dispute.*` branch)
- `supabase/functions/stripe-webhook/index.ts:669-808` (`syncBusinessSubscriptionFromStripe` — the write path a dispute should reuse)
Status: NOT STARTED

## What is wrong

The webhook handles refunds (`charge.refunded`, `refund.created`) and suspends
the location entitlement for them, but it has **no handler for
`charge.dispute.created`** (a chargeback) or `charge.dispute.closed`. A business
can pay, use the product through the billing period, then file a chargeback with
their bank. Stripe claws the money back and emits `charge.dispute.created`, but
Twofer never sees it as a state change — the business keeps `pro_active` /
`active` access until a human notices. This is the classic "paid, disputed,
kept the goods" fraud path, and it is explicitly in scope for this audit.

## Exploit or failure path

1. Business subscribes (real card), gets `app_access_status='active'` and
   `location_entitlements.status='pro_active'`.
2. Business disputes the charge with their card issuer. Stripe creates a dispute
   and sends `charge.dispute.created` to the webhook endpoint.
3. The webhook resolves `businessId` (via the charge's `customer` →
   `business_billing_profiles`) but there is no branch for
   `charge.dispute.created`, so it falls through: `businessId` is set and it is
   not a refund event, so the code enters the business path (line 929) but none
   of the `if/else if` branches match the event type → nothing is written →
   `markProviderEvent('processed')`. Access is unchanged.
4. The business keeps full access with the money reversed until manual review.

## The fix

Treat a created dispute like an immediate suspension, reusing the existing
business sync + entitlement mirror. Two edits:

**1. Recognize the event and force a suspended state.** In the business path
(the `if (businessId && !isRefundWebhookEvent(event.type))` block, ~line 929),
add a branch. `syncBusinessSubscriptionFromStripe` already computes access from
the Stripe subscription status, so add a `forceSuspended` option to it and call
it from the dispute branch. Concretely:

In `syncBusinessSubscriptionFromStripe` params add `forceChargebackSuspend?:
boolean`, and where `access` is computed (line ~681):
```ts
const access = params.forceChargebackSuspend
  ? { billingStatus: "chargeback", appAccessStatus: "suspended" }
  : businessAccessForStripeStatus(status, cancelAtPeriodEnd);
```
(`appAccessStatus: "suspended"` already maps, via
`resolveBusinessAccessLevelForAppAccessStatus` / `resolveLocationEntitlementStatus`,
to `access_level='none'`, `businesses.status` unchanged-or-suspended, and
`location_entitlements.status='canceled_suspended'` with `suspended_at` set — so
`applyBusinessBillingAccessState` will correctly downgrade both mirrors.)

Then in the dispatch block:
```ts
} else if (event.type === "charge.dispute.created") {
  await syncBusinessSubscriptionFromStripe({
    supabase, businessId, event,
    subscription,                    // may be null; that's fine
    forceChargebackSuspend: true,
  });
}
```
Add `"charge.dispute.created"` (and, if you also want to auto-restore on a won
dispute, `"charge.dispute.closed"`) to the list of handled subscription-ish
event types so it reaches this branch. For `charge.dispute.created` the
`event.data.object` is a Dispute whose `.charge` / `.payment_intent` identify
the customer; `stripeCustomerIdFrom` already falls back through
`obj?.customer`/`subscription?.customer`, but a Dispute object has no
`customer` field directly — resolve the customer id from the underlying charge:
retrieve the charge (`stripe.charges.retrieve(obj.charge)`) or read
`obj.payment_intent` and look up the customer, then feed that into the existing
`businessIdForStripeCustomer` lookup so `businessId` resolves. Implement that
customer resolution before the dispatch `if`, so `businessId` is populated for
dispute events.

**2. (Optional, recommended) also suspend the location entitlement explicitly**
for the case where only the location-metadata path applies, mirroring the
refund handler at lines 1007-1020 but with `suspension_reason: "chargeback"`.

**Stripe-side config step (must be done, cannot be inferred from the repo):**
subscribe the webhook endpoint to `charge.dispute.created` (and
`charge.dispute.closed`) in the Stripe Dashboard / API. If the endpoint is not
subscribed to these events, no code change matters.

**Business decision — CONFIRMED (Dan, 2026-07-06): NO auto-restore.** On
`charge.dispute.closed` with `status='won'`, do **not** re-grant access. Leave
the business suspended and require an explicit admin re-activation. Concretely:
you may still subscribe to `charge.dispute.closed` for audit/logging, but its
handler must never move `app_access_status`/`access_level` back to an active
state. Do not write a "restore on won" branch.

## How to verify

1. In Stripe test mode, create a subscription for a test business, then trigger
   a dispute (`stripe trigger charge.dispute.created`, or the test-card dispute
   flow). Confirm the webhook flips `business_subscriptions.app_access_status`
   to `suspended`, `businesses.access_level` to `none`, and
   `location_entitlements.status` to a `*_suspended` value with `suspended_at`
   set.
2. Confirm `can_business_publish` for that business now returns
   `canPublish:false` with a suspended/payment_failed reason.
3. Confirm idempotency: re-deliver the same `charge.dispute.created` event id;
   the `billing_provider_events` dedupe returns `duplicate:true` and no double
   processing occurs.

## Do NOT

- Do **not** delete the subscription or the customer in Stripe from the webhook.
  Suspend access in Twofer's mirror only; Stripe owns the dispute lifecycle.
- Do **not** treat `charge.dispute.created` as a refund and route it through
  `recordRefundWebhookDetails` — a dispute is not a `billing_refund_requests`
  row and there may be no matching refund request; you will silently skip it
  (`!refundContext.locationId` → returns early). Use the business subscription
  sync path.
- Do **not** forget the Stripe Dashboard subscription step; a perfect handler
  for an event you never receive does nothing.

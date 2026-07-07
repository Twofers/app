# Finding 05: Self-serve Stripe checkout has no trial-reuse guard (cancel-and-restart → repeated free trials)

Severity: Medium
Surface: Stripe
Files:
- `supabase/functions/stripe-create-checkout-session/index.ts:243-266` (builds the checkout; no prior-trial check)
- `supabase/functions/_shared/stripe-business-billing.ts` (`ensureStripeCustomerForBusiness`)
- `supabase/migrations/20260726132000_business_trial_identity_controls.sql` (identity/reuse infrastructure that exists)
- `supabase/migrations/20260726136000_admin_trial_identity_reuse_guard.sql` (the admin path IS guarded — `TRIAL_ALREADY_USED`)
Status: NOT STARTED

## What is wrong

The **admin** no-card trial path (`admin_grant_location_trial`) checks for prior
trials and raises `TRIAL_ALREADY_USED` unless explicitly overridden. The
**self-serve** Stripe checkout (`stripe-create-checkout-session`) has **no such
guard**: it authorizes the caller, ensures a Stripe customer, and creates a
subscription checkout. If the subscription carries a trial (Twofer's model is a
"card-required trial that converts to paid"; the trial appears to be embedded in
the Stripe Price, since this function does not pass `trial_period_days`), then a
business that starts a trial, cancels before conversion, and starts checkout
again will receive **another** trial. Repeat indefinitely for perpetual free
access.

I could not read the Stripe Price config, so I cannot confirm the trial is
Price-embedded — **verify that first.** If the Price has no trial and every
checkout is an immediate paid charge, this finding is moot. If it does, the loop
below is live.

## Exploit or failure path

1. Business completes checkout → Stripe creates a `trialing` subscription (card
   on file, no charge yet). Access = trialing.
2. Before the trial converts, the business cancels (Stripe portal or
   `stripe-cancel-trial-subscription`). Subscription deleted; access downgraded.
3. Business calls `stripe-create-checkout-session` again. No code checks whether
   this business/location already used a trial, so a new checkout → new
   `trialing` subscription → free access again.
4. Loop steps 2-3 forever.

## The fix (spec — small, but depends on a business decision)

Before creating the checkout session in `stripe-create-checkout-session`, reject
(or force a no-trial checkout) when this business/location has already consumed a
trial. The infrastructure already exists — reuse it rather than inventing a new
signal:

- Check `business_subscriptions` for a prior row with `trial_type` set or a
  non-null `trial_start` / `first_paid_at` for this `business_id`; and/or
- Check `business_location_identity.trial_used_at` / the
  `check_business_location_trial_reuse(...)` helper used by the admin path, for
  the business's primary location.

If a prior trial is found and the caller is not an admin with an explicit
override, either:
- (a) return a 409 `TRIAL_ALREADY_USED` and steer them to a **paid** (no-trial)
  checkout, or
- (b) create the checkout with the trial suppressed
  (`subscription_data.trial_end: "now"` or a price/coupon with no trial), so the
  card is charged immediately.

**Business decisions:**
1. Trial scope — **CONFIRMED (Dan, 2026-07-06): per physical location.** Key the
   guard on the primary `business_locations` row's identity, reusing
   `business_location_identity.trial_used_at` /
   `check_business_location_trial_reuse(...)` (the same signal the admin path
   uses in `20260726136000`). A merchant must not re-trial the same storefront
   under a new account/business.
2. Behavior on reuse — **not explicitly decided; use recommended default (b):**
   allow the checkout but with the trial suppressed (`subscription_data.trial_end:
   "now"`), so a returning customer can still subscribe but is charged
   immediately with no second free month. Leave the block-vs-convert choice as a
   single clearly-commented branch so Dan can flip it to a hard 409 later.

## How to verify

1. Confirm the Price/trial config in Stripe first.
2. Test-mode: run checkout → trial active → cancel → run checkout again. After
   the fix, the second attempt is blocked or produces a subscription with no
   trial (immediate charge), and `business_location_identity.trial_used_at`
   (or your chosen signal) is respected.
3. Confirm a genuine first-time business still gets exactly one trial.
4. Confirm an admin override (if you keep one) can still grant a fresh trial for
   support cases.

## Do NOT

- Do **not** rely on Stripe alone to prevent repeat trials — Stripe does not
  enforce "one trial per customer" for Price-embedded trials via Checkout, and a
  new customer object sidesteps any per-customer logic anyway.
- Do **not** key the guard only on the Stripe `customer` id; a determined
  merchant makes a new business/customer. Key it on the physical-location
  identity signals the repo already computes.
- Do **not** block a first-time trial by mistake — make sure the "prior trial"
  query is scoped to the same business/location and to *actually consumed*
  trials, not merely an abandoned checkout.

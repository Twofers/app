# Stripe Setup Playbook

End-to-end bring-up for TWOFER billing in **Stripe test mode** for the 10-cafe pilot. Estimated time: **45–60 minutes** end-to-end if you're new to Stripe.

The goal: pilot cafes can sign up, see the trial countdown, and (if they want to test the upgrade flow) click "Subscribe" → land in Stripe Checkout in test mode → return to the app with `subscription_status = active`. **No real money moves in test mode.** When you're ready to flip to live, repeat steps 2–6 in live mode.

---

## What's already built in the app

You don't need to write any code. The following is already shipped:

| Code path | What it does |
|---|---|
| [app/(tabs)/billing.tsx](../app/(tabs)/billing.tsx) | Shows pricing, trial countdown, "Subscribe" button → calls `stripe-create-checkout-session` |
| [supabase/functions/stripe-create-checkout-session/](../supabase/functions/stripe-create-checkout-session/index.ts) | Creates a Stripe Checkout session for Pro or Premium |
| [supabase/functions/stripe-webhook/](../supabase/functions/stripe-webhook/index.ts) | Receives Stripe events; updates `business_profiles.subscription_status` |
| [supabase/functions/stripe-customer-portal-session/](../supabase/functions/stripe-customer-portal-session/index.ts) | Opens Stripe Customer Portal for plan management |
| [supabase/functions/billing-pricing/](../supabase/functions/billing-pricing/index.ts) | Reads pricing from `app_config` so prices aren't hardcoded |
| `business_profiles.subscription_*` columns | Tracks tier, status, Stripe IDs, period end |
| `app_config` table | Holds prices + Stripe price IDs |
| `subscription_history` table | Audit log of plan changes |

You only need to (1) create accounts and IDs in Stripe, (2) set secrets in Supabase, (3) seed `app_config` with the price IDs.

---

## Step 1 — Create your Stripe account (5 min)

1. Go to <https://dashboard.stripe.com/register>
2. Sign up with `twoferadmin@gmail.com` (or whichever email you'll use to manage billing).
3. In the Stripe dashboard, **leave the toggle in the top-right on "Test mode"** for the entire pilot. The toggle says **"Test mode"** in orange when active. You'll see big "TEST" banners — that's correct.
4. You don't need to fill out the full business profile yet (bank account, tax info, etc.) until you flip to live mode for real billing.

> **Why test mode?** Stripe gives you fake card numbers (e.g., `4242 4242 4242 4242`) that go through the full checkout/webhook flow without charging anyone. Pilot cafes can "subscribe" risk-free during the 30-day trial.

---

## Step 2 — Create the Pro and Premium products + prices (10 min)

1. In the Stripe dashboard, go to **Products** → **Add product**.
2. Create **Twofer Pro**:
   - Name: `Twofer Pro`
   - Description: `Unlimited deals, 1 location, full analytics`
   - Pricing: **Recurring**, **Monthly**, **$30.00 USD**
   - Click **Add product**.
   - On the product page, copy the **Price ID** — it looks like `price_1Q...`. Save this somewhere; you'll need it in Step 5.
3. Create **Twofer Premium**:
   - Name: `Twofer Premium`
   - Description: `Unlimited deals, up to 3 locations, advanced AI`
   - Pricing: **Recurring**, **Monthly**, **$79.00 USD**
   - Save the **Price ID** for this one too (e.g., `price_1Q...`).
4. (Optional, can skip for pilot) Add a third product for `Extra location` at **$15/mo** if you want overage billing later.

You should now have two saved Price IDs:
- `STRIPE_PRO_PRICE_ID` = `price_1Q...`
- `STRIPE_PREMIUM_PRICE_ID` = `price_1Q...`

---

## Step 3 — Get your Stripe API keys (2 min)

1. In the Stripe dashboard (still in test mode), go to **Developers** → **API keys**.
2. Copy these two keys:
   - **Publishable key** (`pk_test_...`) — not used by TWOFER right now (only matters for client-side Stripe.js, which we don't use), but save it anyway.
   - **Secret key** (`sk_test_...`) — **this is the important one.** Click "Reveal test key" to see it. Keep it secret; never commit it to git.
3. Save the secret key as `STRIPE_SECRET_KEY` for the next step.

---

## Step 4 — Register the webhook URL (5 min)

The webhook is how Stripe tells the app "hey, this customer just subscribed / canceled / their card failed." Without this, the app will never flip a user from `trial` to `active` after they pay.

1. In Stripe dashboard: **Developers** → **Webhooks** → **Add endpoint**.
2. **Endpoint URL:**
   ```
   https://<YOUR-PROJECT-REF>.supabase.co/functions/v1/stripe-webhook
   ```
   Replace `<YOUR-PROJECT-REF>` with your Supabase project reference (visible in the Supabase dashboard URL — looks like `kvodhiqhdqnptqovovia`).
3. **Listen to:** Select these 4 events (the only ones the webhook code handles):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
4. Click **Add endpoint**.
5. On the new webhook's page, find **"Signing secret"** and click **Reveal**. It looks like `whsec_...`. **Save this** as `STRIPE_WEBHOOK_SECRET` — you'll need it in the next step.

---

## Step 5 — Set the Supabase Edge Function secrets (3 min)

In the Supabase dashboard, go to **Project Settings → Edge Functions → Secrets** (or use the CLI). Add:

| Secret | Value | Where it came from |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` | Step 3 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Step 4 |
| `STRIPE_PRO_PRICE_ID` | `price_1Q...` | Step 2 (Pro product) |
| `STRIPE_PREMIUM_PRICE_ID` | `price_1Q...` | Step 2 (Premium product) |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase dashboard → Project Settings → API) | Already needed for other functions |
| `OPENAI_API_KEY` | (from <https://platform.openai.com/api-keys>) | For AI features |

**CLI alternative:**
```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRO_PRICE_ID=price_1Q... \
  STRIPE_PREMIUM_PRICE_ID=price_1Q...
```

After adding secrets, **redeploy the Stripe functions** so they pick up the new environment:
```bash
npx supabase functions deploy stripe-create-checkout-session
npx supabase functions deploy stripe-webhook
npx supabase functions deploy stripe-customer-portal-session
npx supabase functions deploy billing-pricing
```

---

## Step 6 — Seed the `app_config` table with pricing (5 min)

The app reads prices from a single row in `app_config` instead of hardcoding them. After applying migrations, run this SQL once in the **Supabase SQL Editor**:

```sql
-- Seed pricing for billing-pricing edge function.
-- Adjust prices to match the products you created in Stripe.
insert into public.app_config (key, value, updated_at)
values (
  'billing_pricing',
  jsonb_build_object(
    'proMonthlyPrice', 30,
    'premiumMonthlyPrice', 79,
    'extraLocationPrice', 15,
    'currency', 'USD'
  ),
  now()
)
on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at;
```

> The exact column shape may differ slightly depending on the migration — open `supabase/migrations/20260601153000_billing_v4_app_config_and_subscription_rls.sql` to confirm. The principle is the same: write one row keyed `billing_pricing` with the JSON shape `billing-pricing/index.ts` returns.

---

## Step 7 — Smoke test end-to-end (10 min)

1. In your Android app (test build), sign up as a new business owner: `pilot-test@example.com`.
2. Complete business setup. You should land on the dashboard with a 30-day trial badge.
3. Tap the **Billing** tab. You should see the Pro card with **$30/mo** (and the orange Subscribe button). The Premium card is hidden for the pilot — that's intentional.
4. Tap **Subscribe**. The app opens an in-app browser to Stripe Checkout.
5. Use Stripe's test card: **4242 4242 4242 4242**, any future expiry (e.g., `12/34`), any 3-digit CVC, any ZIP. Click **Subscribe**.
6. Stripe redirects back to the app via the deep link. The Billing screen polls for status. Within ~5–10 seconds, you should see:
   - A green "Current plan" indicator on the Pro card.
   - The header changes to show `subscription_status: active`.
7. Verify in the database:
   ```sql
   select user_id, subscription_status, subscription_tier, stripe_customer_id, stripe_subscription_id
   from business_profiles
   where user_id = '<your-test-user-id>';
   ```
   You should see `active`, `pro`, and the Stripe IDs populated.

**If status doesn't flip to `active` within 30 seconds:**
- Check Stripe **Webhooks** → click your endpoint → look at **Recent deliveries** for failures.
- Check Supabase **Logs** → **Edge Functions** → `stripe-webhook` for errors.
- Most common: wrong `STRIPE_WEBHOOK_SECRET` (signature check fails) or missing `SUPABASE_SERVICE_ROLE_KEY`.

---

## Step 8 — Pilot trial buffer (recommended, 2 min)

To make sure no pilot cafe gets paywalled before billing is fully tested, bump every pilot's `trial_ends_at` to 60 days after they sign up. Run this SQL once after pilot onboarding:

```sql
-- Extend trial for pilot accounts to 60 days from now.
-- Replace the email list with your actual pilot cafe owners.
update public.business_profiles
set trial_ends_at = now() + interval '60 days'
where user_id in (
  select id from auth.users
  where email in (
    'cafe1@example.com',
    'cafe2@example.com'
    -- add the rest
  )
);
```

You can revisit and shorten it once Stripe is rock-solid.

---

## When you're ready for live mode

Repeat steps **2 through 6** with the Stripe test toggle **off** (live mode):
- Re-create the same two products (or use `stripe-cli` to copy them).
- Get a new live secret key (`sk_live_...`).
- Register a new webhook endpoint (live mode webhooks are separate from test mode).
- Update the same Supabase secrets — but now with the live values.
- Re-seed `app_config` if you want different live pricing.

Live mode also requires you to complete your Stripe business profile (legal name, EIN, bank account for payouts) before payments can clear.

---

## Common pitfalls

- **"Webhook signature verification failed"** — the `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint. Test-mode and live-mode have different secrets; using a test secret with a live endpoint (or vice versa) silently fails. Re-copy from the dashboard.
- **App still shows trial after subscribing** — the webhook isn't firing or hasn't reached the function. Check Stripe → Webhooks → Recent deliveries. Re-deploy `stripe-webhook` if it returns 5xx.
- **"Price not found" error in Checkout** — `STRIPE_PRO_PRICE_ID` or `STRIPE_PREMIUM_PRICE_ID` env var doesn't match what's in your Stripe account. Copy the price ID exactly (case-sensitive).
- **Subscribe button does nothing** — check Supabase Logs for `stripe-create-checkout-session`. Most likely: missing `STRIPE_SECRET_KEY` secret.

---

## Quick reference card

What to copy and where:

| Stripe value | Lives in | Used by |
|---|---|---|
| `sk_test_...` (Secret key) | Supabase Edge secret `STRIPE_SECRET_KEY` | Create checkout, customer portal, webhook |
| `whsec_...` (Webhook signing secret) | Supabase Edge secret `STRIPE_WEBHOOK_SECRET` | Verifies inbound Stripe events |
| `price_...` (Pro price ID) | Supabase Edge secret `STRIPE_PRO_PRICE_ID` | Pro Checkout sessions |
| `price_...` (Premium price ID) | Supabase Edge secret `STRIPE_PREMIUM_PRICE_ID` | Premium Checkout sessions |
| Webhook URL | Stripe dashboard → Developers → Webhooks | `https://<ref>.supabase.co/functions/v1/stripe-webhook` |

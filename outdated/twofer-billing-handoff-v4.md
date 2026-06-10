Twofer – Subscription & Billing System Update Handoff (v4 – March 2026)
Prepared by: Dan Sanders Date: March 26, 2026 Purpose: This is a standalone update handoff for the new developer. The original v3 handoff is complete and should not be modified. Use this document as the single source of truth for implementing the subscription & billing system. The app is already pilot-ready; this update adds the post-trial monetization layer while keeping everything extremely simple and AI-friendly.
1. Executive Summary of This Update
We are adding a Stripe-powered subscription model so businesses can continue using Twofer after their 30-day free trial.
•	No money is collected yet (everything runs in Stripe Test Mode only).
•	The flow must feel dead simple: 2 taps max to subscribe, heavy use of dropdowns, autocomplete, and AI-friendly copy.
•	Pricing lives in Supabase so it can be changed instantly without code changes.
•	Multi-location support is added as a foundation (even though full multi-location billing comes in v2).
•	Everything must match the existing premium orange theme (#FF9F1C), penguin mascot, and “strong-deal guardrail.”
Target launch: Ready for the 10-cafe pilot (free trial → paid conversion).
2. Subscription Tiers (Exact)
Prices and features are stored in a new Supabase table (see section 5) so they can be edited live.
Tier	Monthly Price	Active Deals	Locations Allowed	AI Deal Features	Analytics & Extras	Best For
Free Trial	$0 (30 days)	1	1	Basic AI generator	Basic dashboard	Pilot testing
Twofer Pro	$30	Unlimited	1	Basic AI generator	Full analytics	Most independent cafes
Twofer Premium	$79	Unlimited	Up to 3	Advanced AI (unlimited variants + best-time suggestions)	Full analytics + exportable consumer insights	Ambitious owners / future chains
Extra locations (Premium only): +$15 per additional location per month (automatic add-on). Future price changes (e.g. Pro to $39) will be done by editing the app_config table only.
3. User Flow (Must Be This Simple)
Business Mode → New “Billing” tab (add as 4th tab in business bottom navigation, orange theme):
1.	Screen shows: “Your 30-day trial ends in X days” (countdown + orange warning if expired).
2.	Two large cards: Pro ($30/mo) and Premium ($79/mo) with clear feature lists (use checkmarks and dropdowns where possible).
3.	Big orange “Subscribe Now” button on each card.
4.	Button → calls Supabase Edge Function → Stripe creates Checkout Session → opens Stripe Checkout web page in browser (secure, hosted by Stripe).
5.	After payment success → automatic redirect back to app + instant status update via webhook.
6.	New “Manage Subscription” screen (cancel, upgrade, view invoices, see current tier).
Paywall trigger: If trial expires or user tries to create a deal while inactive → gentle redirect to Billing tab with orange “Reactivate your account” message.
Multi-location rules (foundation only):
•	Every deal must be tied to a specific location.
•	When creating a deal: big dropdown “Select location” (autocomplete address via Google Places if possible).
•	Toggle: “Apply this same deal to multiple locations?” → app auto-duplicates the deal (same text/image/offer, different location_id, address, and QR code).
•	Pro users can only select 1 location; Premium users see up to 3.
4. Technical Requirements
Stack reminder: Expo React Native + Supabase (edge functions on Deno). Use only existing premium visual style (bright penguin orange, 24px corners, deep shadows, Reanimated animations).
Stripe setup (do this first):
•	Stripe account in Test Mode.
•	Create two recurring prices:
o	Pro: $30/month
o	Premium: $79/month
•	Enable 30-day free trial on both prices (Stripe handles it automatically).
New screens to build:
•	BusinessBillingScreen.tsx (main list + cards)
•	ManageSubscriptionScreen.tsx (cancel/upgrade view)
•	Update CreateDealScreen.tsx to include location dropdown + multi-location toggle.
5. Database Changes (Exact SQL)
Run these in Supabase SQL editor:
SQL
-- New config table for easy pricing changes
CREATE TABLE app_config (
  id integer PRIMARY KEY DEFAULT 1,
  pro_monthly_price integer DEFAULT 30,
  premium_monthly_price integer DEFAULT 79,
  extra_location_price integer DEFAULT 15,
  updated_at timestamptz DEFAULT now()
);

-- Add to business_profiles table
ALTER TABLE business_profiles
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_status text DEFAULT 'trial', -- trial, active, past_due, canceled
  ADD COLUMN subscription_tier text DEFAULT 'pro',     -- pro, premium
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN current_period_ends_at timestamptz;

-- New locations table (foundation for multi-location)
CREATE TABLE business_locations (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  business_id uuid REFERENCES business_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  phone text,
  lat double precision,
  lng double precision,
  created_at timestamptz DEFAULT now()
);

-- Update deals table
ALTER TABLE deals
  ADD COLUMN location_id uuid REFERENCES business_locations(id) ON DELETE CASCADE;
Add RLS policies so only active/trial businesses can create deals or view analytics.
6. Supabase Edge Function (Stripe Webhook)
Create one new edge function named stripe-webhook. Use the official Supabase + Stripe Deno template. Listen for these events only:
•	customer.subscription.created
•	customer.subscription.updated
•	customer.subscription.deleted
•	invoice.payment_succeeded
The function must:
•	Create/update the business_profiles columns above.
•	Handle trial → active conversion automatically.
•	Log everything to a new subscription_history table (optional but recommended).
7. Testing & Developer Rules
•	Test everything in Stripe Test Mode (use card 4242 4242 4242 4242).
•	Add a hidden dev-only button “Simulate Subscribe” that instantly upgrades the logged-in business in the DB (no Stripe call).
•	Before any change ask: “According to this v4 handoff, is this allowed?”
•	Keep the strong-deal guardrail untouched.
•	All new UI must use the exact orange theme and feel as premium as the rest of the app.
•	Pricing must always be read from the app_config table on app load.
•	After this update the app is ready for the 10-cafe pilot.
This document is complete and self-contained. The developer should be able to implement the entire subscription system independently.
Next step for developer: Confirm you have read this full handoff and are ready to start with the database changes + Stripe account setup.


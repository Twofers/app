# Claim rules — current enforcement (verified 2026-07-02)

Source of truth: `supabase/functions/claim-deal/index.ts`,
`supabase/functions/_shared/repeat-claim-policy.ts`, and the migrations named below.
If this doc and the code disagree, the code wins.

## Rules enforced server-side (cannot be bypassed by the app)

| Rule | Where enforced |
|---|---|
| Rate limit: max 3 claim attempts per user per minute (any deal) | `claim-deal` (429) |
| One active claim app-wide per user: while a claim is active/redeeming, unredeemed, and unexpired, claiming any *other* deal is blocked (409 `CUSTOMER_ALREADY_HAS_ACTIVE_DEAL`). Re-claiming the *same* deal is idempotent and returns the existing ticket (200). | `claim-deal`, plus race-safe unique partial index (`20260703120005_claim_race_guards.sql`) |
| Business repeat policy: per-business setting `businesses.repeat_claim_policy_type` — `NONE` (default, no limit), `COOLDOWN_DAYS` (blocked for N days after the last **redemption** at that business), `FOREVER` (first-time customers only, based on prior **redemption**). Prior unredeemed claims never trigger this. | `claim-deal` + `_shared/repeat-claim-policy.ts` (409) |
| Per-deal claim cap: `deals.max_claims`, counting all non-canceled claims | `claim-deal` (409) plus atomic DB trigger (`20260704130000_enforce_max_claims_atomic.sql`, `MAX_CLAIMS_REACHED`) |
| Schedule gates: not started / expired / claim-cutoff buffer / recurring day + time window (deal timezone) | `claim-deal` (400) |
| Demo offers cannot be claimed | `claim-deal` (400) |
| Suspended-billing locations cannot take new claims | `claim-deal` + `_shared/billing-suspension.ts` (403) |
| Redeem window: a claim is redeemable until `expires_at` + 10-minute grace | `claim-deal` sets `grace_period_minutes`; redeem functions enforce it |

## Rules that exist only client-side (advisory, not enforced)

- The deal detail screen pre-renders "Sold out" / "Not active" / "Claim closed" states so
  users see the block before tapping. These mirror the server checks; the server remains
  authoritative (`app/deal/[id].tsx`, `lib/deal-time.ts`, `lib/deal-action-state.ts`).

## Rules that no longer exist (stale references corrected 2026-07-02)

- **"One claim per business per local day"** — removed; replaced by the redemption-based
  business repeat policy above. Stale mentions were corrected in
  `docs/beta-release-checklist.md`, `docs/store-release-prep.md`, and `docs/TWOFER_GAP_AUDIT.md`.
  Legacy error-message mappings for the old rule remain in `lib/i18n/api-messages.ts` and
  `app/(tabs)/wallet.tsx` (`classifyClaimBlockReason`) only as translation/telemetry fallbacks
  for old server messages; they do not enforce anything.
- **"One claim per hour"** — never the current rule; the actual rate limit is 3 attempts
  per minute. The `apiErrors.claimHourlyLimit` string is a legacy mapping only.

## Product notes

- "Returning" analytics: `merchant_deal_insights` / `merchant_business_insights` flag a claim
  as returning when the same user has **any earlier claim** at the business — not a confirmed
  second visit or prior redemption. Dashboard copy was reworded accordingly
  (`merchantInsights.newVsReturning`).
- The business repeat policy defaults to `NONE`, so by default nothing stops a customer from
  claiming again after redeeming — the return path (favorites prompt + saved-customer alerts)
  is the retention mechanism, not a claim restriction.

# Open questions

Items below need an **operator / product** decision after the launch-hardening work in code and docs:

1. **Store build legal URLs** — Confirm the `EXPO_PUBLIC_PRIVACY_POLICY_URL` and `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` values on the **exact** EAS build you submit match the pages referenced in store listings (defaults in `lib/legal-urls.ts` point at `https://www.twoferapp.com/...`).

2. **Legacy claims backfill (optional)** — If production has old `deal_claims` rows where `expires_at` may not match the current rule (instance end only; grace applied at redeem time), decide whether a **one-off SQL adjustment** is needed after data review. Fresh environments can ignore.

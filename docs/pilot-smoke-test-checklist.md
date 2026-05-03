# Pilot Smoke Test Checklist (Hosted Supabase)

Use this in a hosted environment (not local-only) before inviting pilot cafes.

## End-to-End Happy Path

1. Create a **consumer** account and verify sign-in success.
2. Complete consumer onboarding.
3. Allow location access (or enter ZIP if prompted).
4. Create a **business** account.
5. Enter invite code and confirm business access is granted.
6. Complete business setup profile.
7. Create at least one menu item (scan or manual entry).
8. Upload a deal photo.
9. Create a strong deal (meets 40%+ / BOGO / free-item rule).
10. Publish the deal.
11. Open consumer app/feed and verify published deal appears.
12. Claim the deal.
13. Open Wallet and verify active claim appears with expiry.
14. Start visual redeem.
15. Complete visual redeem.
16. Scan QR or enter short code on merchant side and confirm redeem success.
17. Open business dashboard and confirm claim/redeem metrics update.
18. Submit a report from app.
19. Confirm the report row appears in Supabase data for the expected business/user.

## Negative Tests

- Weak deal under 40% discount is rejected.
- Expired deal cannot be newly claimed.
- Max claims reached blocks additional claims.
- Same user cannot claim twice within one hour limit.
- Same user cannot claim same business twice in one local day.
- Business user cannot create deal when business profile is incomplete.
- Consumer denies location permission and can still proceed with ZIP fallback.
- Bad ZIP shows clear, user-friendly validation error.
- Very large image upload fails gracefully with plain-language message.
- Blurry menu photo triggers low-legibility guidance (not silent success).
- Missing `OPENAI_API_KEY` for `ai-extract-menu` returns clear configuration error in production mode.
- No internet during claim/redeem/create flow shows friendly retry guidance (no raw stack/infra error).

## Pilot Readiness Exit Criteria

- Happy-path steps complete without manual DB patching.
- All negative tests return clear user-facing messages.
- No raw Supabase/RLS/internal error strings are shown to users in tested paths.
- Dashboard and analytics events are present enough for pilot support triage.

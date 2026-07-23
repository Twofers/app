# Share Deal audit

## F-009 — Public share preview does not resolve its code (P2)

The live safe GET of `/s/ABCDEFG` showed generic “open this offer” content with no business/deal preview and no missing/expired distinction. `website/s/index.html` contains no lookup implementation. A hardened, public-safe `lookup_deal_share` function exists at `supabase/migrations/20260715120000_share_lookup_hardening.sql:16-168`, but the page does not call it.

Impact: desktop/non-installed recipients cannot identify the offer; invalid, expired, disabled, and missing links look alike; generic metadata weakens social sharing. This is material because Share Deal is a locked v1 feature.

Implement a narrow server/public lookup, render only approved fields from approved businesses/deals, distinguish states without enumeration leakage, add safe metadata where hosting supports it, and retain app/deep-link fallback. Add abuse/rate controls and avoid exposing internal IDs or private location/contact fields.

## F-010 dependency

Both store URLs are null in `website/store-links.js:3-5`; a recipient without the app has no install destination.

## Verification required

Test valid, expired, redeemed, disabled, deleted, missing, malformed, case-varied, and brute-force codes; installed/not-installed iOS/Android; desktop; social unfurl; locale; accessibility; and public output isolation. No valid production share code was accessed during this audit.


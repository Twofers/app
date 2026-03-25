# Launch gap checklist

Legend: **Green** = verified in this codebase. **Yellow** = ops / device QA / production config outside the repo. **Red** = true launch blocker still present in code (none intended below).

**Product decisions (locked in code):**

- **Recurring deals:** Each claim stores a concrete `expires_at` (one-time = `deal.end_time`; recurring = today’s window end in deal TZ, capped by campaign `end_time`). Redemption is allowed until **`expires_at` + `grace_period_minutes` (default 10)** on the server.
- **Visual redeem:** `active → redeeming → redeemed`. No revert to `active`. **`finalize-stale-redeems`**, **`begin-visual-redeem`**, **`complete-visual-redeem`**, and **`redeem-token`** auto-finalize `redeeming` claims **~30s** after `redeem_started_at` as **`redeemed`** / `redeem_method: visual`.
- **Privacy / Terms / Support / Delete (web):** `LegalExternalLinks` + `lib/legal-urls.ts`; production defaults `https://www.twoferapp.com/privacy`, `/terms`, `/support`, `/delete-account` (each overridable with matching `EXPO_PUBLIC_*`). Links on auth, account, settings, business setup, forgot-password, reset-password; delete web URL in Account delete section (consumer path) and failure alert.
- **Delete account:** **Consumers** (no owned business row): Account → **Delete my account** → confirms → `delete-user-account` Edge → `auth.admin.deleteUser`. **Business owners** (or ambiguous ownership load): in-app self-delete **blocked** with localized **contact support** copy; Edge returns **403** `BUSINESS_OWNER_DELETE_BLOCKED` if invoked. See `docs/deployment-notes.md` and `docs/release-audit/current-state.md`.
- **Merchant analytics:** Aggregated only via RPC `merchant_business_insights` / `merchant_deal_insights` (masked ZIP prefixes, banded age, mixes, hourly counts). No raw user lists in UI.

## True launch blockers (ops / config)

| Item | Status | Notes |
|------|--------|--------|
| Apply SQL migrations (full set in `docs/deployment-notes.md`, incl. `merchant_insights_rpc`) | **Yellow** | Required for schema + RPC-based insights. |
| Deploy Edge functions (exact list in `docs/deployment-notes.md`) | **Yellow** | Must match client `invoke` names. |
| Website: host Privacy, Terms, Support, Delete-account pages at URLs the app uses | **Yellow** | App defaults verified in code (`lib/legal-urls.ts`); **hosting** those paths on `www.twoferapp.com` (or your overridden URLs) is still an ops step. |
| Service role available to Edge functions that need it | **Yellow** | e.g. `SUPABASE_SERVICE_ROLE_KEY` for `delete-user-account` and other admin/service paths. |

## Auth & account

| Item | Status |
|------|--------|
| Sign up / log in / log out / reset password | **Green** |
| Delete account: consumer in-app + Edge; business owner blocked + support guidance | **Green** |

## Legal (app-side)

| Item | Status |
|------|--------|
| Privacy + Terms + Support links wired (`LegalExternalLinks` / `lib/legal-urls.ts`) on auth, account, settings, business setup, forgot/reset password | **Green** |
| Delete account web URL (Account consumer path + failed in-app deletion alert) | **Green** |
| Copy matches hosted policy pages | **Yellow** (content/legal review) |

## Consumer: wallet & redeem

| Item | Status |
|------|--------|
| Wallet active / ended; redeem-by = `expires_at` + grace | **Green** |
| Use Deal → slide → pass; QR backup | **Green** |
| `finalize-stale-redeems` on wallet load | **Green** |
| Server idempotency / stuck `redeeming` TTL | **Green** |

## Merchant dashboard & deal analytics

| Item | Status |
|------|--------|
| Summary counts + conversion | **Green** |
| RPC insights (age, ZIP clusters, acquisition, methods, hour peak, new vs returning, avg delay) | **Green** (after migration deploy) |
| No raw customer identity in merchant UI | **Green** |

## i18n (EN / ES / KO)

| Item | Status |
|------|--------|
| New strings: delete account (incl. business-owner block), merchant insights, pass close copy | **Green** |

## Store readiness

| Item | Status |
|------|--------|
| Icons / splash / listings | **Yellow** (not audited here) |
| POS integrations (Stripe / Shopify) | **Green** (explicitly out of scope) |

## Real-device QA

See **Real-device QA checklist** in `docs/deployment-notes.md`.

# Multilingual status (EN / ES / KO)

Use this file as a **living checklist**. Tick items in your PR or delete rows when obsolete.

## Foundation

| Item | Done |
|------|------|
| `i18next` + `react-i18next`; `lib/i18n/locales/{en,es,ko}.json`; `fallbackLng: en` | ✓ |
| Device → `en` \| `es` \| `ko`; AsyncStorage + manual override (`AppI18nGate`, Account) | ✓ |
| `businesses.preferred_locale` for offers / AI / deal-quality banners | ✓ |
| Edge: `output_language` on AI ad generation | ✓ |

## UI surfaces

| Area | Done | Notes |
|------|------|--------|
| Tab labels | ✓ | `tabs.*` |
| Home / deals browse | ✓ | `dealsBrowse.*`, `dealDetail.*` fallbacks |
| Favorites | ✓ | `favorites.*`, shared browse keys |
| Create hub | ✓ | `createHub.*` |
| Quick deal | ✓ | `createQuick.*` |
| AI deal screen | ✓ | `createAi.*` (+ ES/KO merge overrides) |
| Account (auth, profile, alerts, language) | ✓ | `account.*`, `auth.*`, `language.*`, `tabMode.*` |
| Redeem (scanner) | ✓ | `redeem.*` |
| Deal detail (consumer) | ✓ | `dealDetail.*`, `consumerDealDetail.*` as applicable |
| Wallet / QR modal | ✓ | `consumerWallet.*` |
| Business dashboard / analytics | ✓ | Partial; verify any new copy |
| Root modal chrome | ✓ | `commonUi.modalTitle`, `modalScreen.*` |
| Deal validity summary | ✓ | `dealValidity.*`, date-fns locale |

## API & error strings

| Item | Done | Notes |
|------|------|--------|
| Edge: `claim-deal`, `redeem-token` | ✓ | Exact + dynamic prefixes in `lib/i18n/api-messages.ts` |
| Edge: `ai-generate-ad-variants`, `ai-create-deal`, `ai-generate-deal-copy` | ✓ | Same file (`API_MESSAGE_KEY`) |
| Client invoke fallbacks (`functions.ts`) | ✓ | Same mapper |
| Postgres / RLS / JWT / network heuristics | ✓ | Regex table → `apiErrors.db*` / `sessionExpired` / `networkFailed` |
| Long or internal-looking blobs | ✓ | `apiErrors.operationFailedTryAgain` (no raw leak) |
| Raw / unknown short user-facing English | — | Still passed through; add an exact key when you introduce a new fixed `error` string on the server |

## Push (local)

| Item | Done | Notes |
|------|------|--------|
| Favorite new-deal local notification | ✓ | `pushTemplates.*` + `i18n.t` in `lib/notifications.ts` (`newDealsBody_one` / `_other`) |
| Server-driven push (FCM/APNs) | — | When shipped: templates per locale at send time |

## Backlog (not exhaustive)

| Item | Priority |
|------|----------|
| Remote push payloads localized on server | When shipped |
| `parseFunctionError` + nested JSON `details` | Optional: map `details` snippets or log-only |
| New Edge `error` literals | Add to `API_MESSAGE_KEY` + `apiErrors` / reuse key |

## Testing checklist

### English (regression)

1. Cold start, English device → UI English; `npm run test` (includes `api-messages` map) + `npm run test:english` for deal-quality copy.
2. Quick Deal: valid BOGO → publish OK; blocked deal → banner text OK.
3. Claim deal → errors from `claim-deal` map to readable English (rate limit, sold out, etc.).

### Spanish / Korean

1. Account → app language ES or KO → tabs + Account + browse + redeem labels localized.
2. **Offers & AI** override vs app language → deal-quality + AI output as designed.
3. Trigger a known API error (e.g. expired token) → banner uses `apiErrors.*` in that language.

### Fallback

1. Remove one `ko.json` key → English fallback for that string.
2. Invalid `preferred_locale` row → client treats as null.

## Deploy notes

- Apply migrations for `preferred_locale` before Account save.
- Redeploy Edge functions when changing `error` strings — update `lib/i18n/api-messages.ts` + `apiErrors` in locale files to match.

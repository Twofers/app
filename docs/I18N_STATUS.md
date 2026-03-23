# Multilingual status (EN / ES / KO)

## Fully wired (this branch)

| Area | Status |
|------|--------|
| **i18n foundation** | `i18next` + `react-i18next`, `lib/i18n/locales/{en,es,ko}.json`, fallback `en` |
| **First launch + persistence** | Device → `en` \| `es` \| `ko` (else `en`); stored in AsyncStorage; manual override flag |
| **App UI (partial)** | Tab labels; **Quick Deal** screen; **Account** title + language controls + alerts toasts; business **Offers & AI language** (saved to DB) |
| **Business preference** | `businesses.preferred_locale` (`NULL` \| `en` \| `es` \| `ko`) — migration `20260130120000_business_preferred_locale.sql` |
| **AI ad generation** | Client sends `output_language`; Edge Function instructs model to write all ad fields in that language |
| **Deal-quality banners** | `blockReason` + `translateDealQualityBlock()` using `resolveDealFlowLanguage(businessPreferredLocale, appLanguage)` |
| **Korean deal heuristics** | Extra patterns in `lib/deal-quality.ts` (e.g. `1+1`, `원플원`, `%할인`, …) |
| **English regression** | `npm run test:english` — unchanged English **logic** + `message` text; asserts `blockReason` |

## Still English-only (incremental backlog)

- Home feed (`index.tsx`), favorites body, create tab hub, AI screen **bulk** copy, deal detail, redeem, analytics, auth strings (except where touched), shared error toasts from Supabase functions, modal title.
- **Push notifications** — when implemented, resolve copy using stored user locale (see `lib/notifications.ts` / future user metadata).
- **Favorites** — no schema change; notification payloads should carry or resolve locale at send time.

## Testing checklist

### English (regression)

1. Cold start on English device → UI English; `npm run test:english` passes.
2. Quick Deal: publish valid BOGO → succeeds; invalid % → English banner matches legacy tone.
3. AI generate with `preferred_locale` null → `output_language` = app language (verify in function logs / output).

### Spanish

1. Account → App language **Español** → tabs + Quick Deal Spanish.
2. Set **Offers & AI** to Spanish, app English → Quick Deal quality message Spanish; AI ads Spanish.
3. Deal title with Spanish BOGO patterns still passes quality rules.

### Korean

1. Account → **한국어** → tabs + Quick Deal Korean; check long labels wrap (e.g. field labels).
2. Title containing `1+1` / `원플원` → strong tier (see unit test).
3. AI output Korean when business or app locale is `ko`.

### Fallback

1. Remove a key from `ko.json` → UI shows English string for that key.
2. `preferred_locale` invalid / old row → client treats as null, uses app language.

## Deploy notes

- Apply Supabase migration for `preferred_locale` before relying on Account save.
- Redeploy **`ai-generate-ad-variants`** Edge Function so `output_language` is honored.

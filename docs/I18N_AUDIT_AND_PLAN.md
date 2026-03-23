# I18n audit & rollout plan (EN / ES / KO)

## Stage 1 — Audit summary

### Where strings live today (high risk)

| Area | Files / pattern | Notes |
|------|------------------|--------|
| **Tab bar** | `app/(tabs)/_layout.tsx` | Hard-coded `Deals`, `Favorites`, `Create`, `Redeem`, `Account` |
| **Home / feed** | `app/(tabs)/index.tsx` | Headings, empty states, errors |
| **Favorites** | `app/(tabs)/favorites.tsx` | Same |
| **Create tab** | `app/(tabs)/create.tsx` | Business creation, navigation labels |
| **Quick deal** | `app/create/quick.tsx` | All labels, validation banners, publish errors |
| **AI ads** | `app/create/ai.tsx` | Large surface: validation, banners, day labels, CTAs, errors |
| **Account / auth** | `app/(tabs)/account.tsx` | Auth, profile, notifications, business setup |
| **Auth** | `app/(tabs)/auth.tsx` | If present separately |
| **Deal detail** | `app/deal/[id].tsx` | Consumer-facing copy |
| **Redeem** | `app/(tabs)/redeem.tsx` | Scanner / redeem flow |
| **Analytics** | `app/deal-analytics/[id].tsx` | Business metrics labels |
| **Shared UI** | `components/ui/*`, `Banner`, buttons | Some props are English-only from parents |
| **Root stack** | `app/_layout.tsx` | Modal title `Modal` |
| **Deal quality** | `lib/deal-quality.ts` | English message constants → **block reason codes** + JSON translations |
| **AI Edge** | `supabase/functions/ai-generate-ad-variants/index.ts` | System prompt English; **output language** injected from client |
| **Other functions** | `claim-deal`, `redeem-token`, etc. | API error strings (mostly English) — future pass |
| **lib/ad-variants.ts** | `CREATIVE_LANE_LABEL` | Lane labels for UI — should use `t()` at call site |

### Data / persistence risks

- **No** `profiles` table for consumers — app-only prefs (AsyncStorage) for **UI language** is correct for MVP.
- **`businesses`** row: add **`preferred_locale`** (`en` \| `es` \| `ko`) for **AI / offer copy language**; RLS already allows owner update.
- **Favorites / future push**: store `locale` or rely on device + user preference at send time — document in `I18N_STATUS.md` (no schema change required now).

### Localization risks

1. **Inline concatenation** — avoid; use `t()` with keys or ICU-style params later.
2. **RegEx deal-quality** — language-specific offer phrases must be maintained per locale (EN/ES/KO); numeric `%` rules stay shared.
3. **AI** — must not guess language; pass explicit `output_language` from **business preference** with fallback to **app UI locale**.
4. **Split settings** — **App language** (UI) vs **business offer & AI language** (DB): both exist in MVP; if only one is set, AI uses `business.preferred_locale ?? app locale`.
5. **English regression** — `lib/deal-quality.english-regression.test.ts` locks EN **logic**; `blockReason` + unchanged EN `message` text keeps tests stable.

---

## Recommended architecture

- **i18next** + **react-i18next** + **expo-localization** + **AsyncStorage** for UI locale + manual override flag.
- **Locale files**: `lib/i18n/locales/{en,es,ko}.json` — nested keys, **`en` complete**, ES/KO grow over time; **fallbackLng: `en`**.
- **Init**: `AppLocalizationProvider` in root `app/_layout.tsx`; async hydrate locale from storage + first-launch rules.
- **Deal quality**: `assessDealQuality()` returns `blockReason` + legacy English `message`; UI uses `i18n.t('dealQuality.blocks.' + blockReason, { lng })` with `lng = business.preferred_locale ?? i18n.language` on create flows.
- **AI**: Client sends `output_language` in `ai-generate-ad-variants` body; Edge Function appends “write all ad fields in {language}”.

---

## Rollout stages (testable)

| Stage | Scope | Exit criteria |
|-------|--------|----------------|
| **1** | This doc + risks | Team sign-off |
| **2** | i18n init, `en` strings extracted for **tabs + account language UI + quick deal + deal quality keys** | App runs; EN identical copy |
| **3** | ES/KO JSON for same keys; device detect + manual persist; `businesses.preferred_locale` + Account UI; AI `output_language` | Manual smoke EN/ES/KO |
| **4** | Remaining screens (index, favorites, ai.tsx bulk, deal detail, redeem) incrementally | Checklist in `I18N_STATUS.md` |
| **5** | Push templates / server errors | Product backlog |

---

## MVP language behavior (explicit)

- **Default**: English fallback for missing keys.
- **First launch**: Map device locale to `en` \| `es` \| `ko`; else `en`. Persist chosen value; do not set “manual override” until user opens language control.
- **Manual override**: User selects language in **Account** → persist + `i18n.changeLanguage` + set manual flag.
- **Business**: **Offer & AI language** saved on `businesses.preferred_locale`; AI requests use it; deal-quality banners on create screens prefer `preferred_locale` then fall back to app language.
- **No** mixing languages on one screen except user-generated deal text vs system chrome (expected).

---

## AI vs UI language (recommendation)

- **MVP**: Keep **two** controls when user has a business: **App language** (UI) and **Offers & AI language** (DB). If business locale is null, AI uses app language.
- **Safest single-toggle MVP** (not implemented): one language drives both — would confuse bilingual staff; documented as future simplification.

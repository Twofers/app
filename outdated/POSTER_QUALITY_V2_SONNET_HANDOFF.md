# Poster Quality v2 — Implementation Handoff (for Sonnet 5 on high)

Date: 2026-07-06
Prepared by: Fable 5 (design/verification pass). Approved by: Dan (chat, 2026-07-06).
Approval scope: the exact file lists in this document. This document IS the per-file approval
record source required by `docs/ai-poster-core-lock.md` — copy its date/reference into
`docs/ai-poster-core-lock.json` approvalRef entries as you update hashes.

## What this ships

Two flag-gated workstreams (plus one no-code runbook Dan runs himself):

- **Phase L — posters render in the viewer's language.** Today a Spanish/Korean consumer sees
  the poster in English even though localized poster copy builders exist and are tested.
- **Phase 2 — Poster Look v2.** Real display typography, an offer badge as the visual anchor,
  lighter photo scrims. Behind a hidden build flag; the current look stays byte-identical when
  the flag is off.
- **Phase 1 (Dan only, no code)** — Gemini image provider activation. Listed here only so you
  don't duplicate it. Do NOT touch edge functions, image prompts, or provider config.

Work order: **Phase L first, then Phase 2.** One branch for both. Do not start Phase 2 until
Phase L gates pass.

## Ground rules (do not skip)

1. **Poster core lock**: every locked file you touch requires updating its entry in
   `docs/ai-poster-core-lock.json` (new `sha256` via the same normalized hashing the gate uses,
   `approvalRef: "2026-07-06 chat approval: poster quality v2 handoff (POSTER_QUALITY_V2_SONNET_HANDOFF.md)"`,
   and a one-line rationale). Then run `npm run gate:ai-poster-lock` until green. `npm test`
   runs this gate via pretest — tests will fail until the manifest is updated.
2. **Do not deploy anything.** No `supabase functions deploy`, no `supabase db push`, no builds.
   All server behavior is untouched by design.
3. **Do not modify**: `lib/poster/posterCopy.ts`, `lib/poster/posterPolicy.ts`,
   `lib/poster/posterAdSpec.ts`, any `supabase/functions/**`, any AI prompt file, `eas.json`
   production env values (only ADD the two new flag keys where Dan approves), or any file not
   listed below. The working tree has unrelated uncommitted work — leave it alone.
4. **Commit only when Dan asks.** Never push.
5. Validation baseline for both phases: `npm run typecheck`, `npm run lint`, `npm test`.
   No edge-function checks are needed (no function changes).

## Verified architecture facts (trust these; they were checked on 2026-07-06)

- Consumer poster rendering path: feed/detail fetch specs via `fetchCustomerDealPosterSpecs`
  (`lib/customer-deal-poster-specs.ts`, RPC `customer_deal_poster_specs`) →
  `ComposedAdCard` → `PosterOfferTemplate` → `AdPosterCanvas`.
- `ComposedAdCard` renders only when `EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED=true` — it IS
  true in all eas.json profiles, so this is the live consumer path.
- **Bug being fixed (Phase L):** `posterSpecForAd` in `lib/ad-spec.ts` (~line 317) calls
  `normalizePosterSpecForPublish`, which strips `copy_by_language` to `{"en-US": ...}` before
  publish. And `posterCopyFromSpec` in `components/poster/AdPosterCanvas.tsx` hardcodes
  `copy_by_language["en-US"]`. The fix helper already exists and is dead code:
  `posterCopyForLocale` in `lib/poster/posterAdSpec.ts:34`.
- Multi-locale specs are SAFE end-to-end without server changes:
  - `parsePosterSpecV1` already parses every supported locale.
  - `publish-offer-version` validates via `validatePosterSpecV1`, which checks each present
    locale's offer lines against `buildPosterOfferLinesFromOfferDefinition(definition, locale)`
    — the same builder that created them, so they match. No edge redeploy needed.
  - Older app builds reading a multi-locale spec keep picking `en-US`. Fully backward compatible.
- Supported locales: `en-US`, `es-US`, `ko-KR` (`lib/supported-locales.ts`;
  `supportedLocaleOrDefault()` maps i18n language codes like "es" → "es-US").
- Poster copy strings are stored ALREADY UPPERCASE (`sanitizePosterText` uppercases by default;
  business_name is the exception). Design v2 for caps; do not add mixed-case transforms and do
  not touch the sanitizers.
- Owner preview (`app/create/ai.tsx` ~line 4298) passes `spec` + `eyebrowLabel` +
  `liveScheduleLabel` into `AdPosterCanvas`. It flows through the same locale resolution you add,
  so the owner sees their own language automatically. Note: consumer surfaces never pass
  `eyebrowLabel`, so the kicker only appears in owner preview today — that is existing behavior,
  keep it.
- Known limitation to preserve (do NOT "fix"): for non-English locales the creative headline is
  deliberately replaced by the localized item line (`copyForLocale` in posterCopy.ts). Translated
  creative headlines are future work.
- Flag pattern to copy: `isShareDealEnabled()` in `lib/runtime-env.ts` + an entry in
  `getPublicEnvSnapshot()` + assertions in `lib/runtime-env.test.ts` (see the AI_V5 flag tests
  around lines 231/279 for the exact pattern).
- Fonts: `expo-font` and `@expo-google-fonts/outfit` are already dependencies (Outfit_700Bold is
  the auth wordmark, loaded per-component with `useFonts` — see `app/auth-landing.tsx:222`).

---

# Phase L — posters speak the viewer's language

## Flag

`EXPO_PUBLIC_POSTER_VIEWER_LANGUAGE_ENABLED` → `isPosterViewerLanguageEnabled()` in
`lib/runtime-env.ts`. One flag gates BOTH sides (publish keeps all locales + render resolves
locale). Flag off = today's behavior exactly.

## Edits

1. **`lib/runtime-env.ts`** (not lock-protected): add `isPosterViewerLanguageEnabled()` +
   snapshot entry, following `isShareDealEnabled()`.
2. **`lib/ad-spec.ts`** (LOCKED): in `posterSpecForAd`, when the flag is on return `parsed`
   (full `copy_by_language`); when off keep `normalizePosterSpecForPublish(parsed)`.
3. **`components/poster/AdPosterCanvas.tsx`** (LOCKED):
   - Add optional prop `contentLocale?: SupportedLocale | null`.
   - Replace the hardcoded pick in `posterCopyFromSpec` usage: when the flag is on and
     `contentLocale` is provided, resolve via `posterCopyForLocale(spec, contentLocale)`
     (import from `@/lib/poster/posterAdSpec`); otherwise keep current behavior.
   - Keep `posterCopyFromSpec` exported with its current signature (tests reference it); add the
     locale-aware path alongside, don't break the old one.
4. **`components/composed-ad-card/types.ts`** (not lock-protected): add optional
   `contentLocale?: SupportedLocale | null` to the template props.
5. **`components/composed-ad-card/templates/PosterOfferTemplate.tsx`** (LOCKED): pass
   `contentLocale` through to `AdPosterCanvas`.
6. **Callers** — thread the locale into `ComposedAdCard`:
   - `app/(tabs)/index.tsx`: the feed already resolves per-deal display language for
     `localizedDisplay` (state `customerPreferredDealLocale`, `getDeviceDealLocale()`, the
     `CustomerDealLocalization` map). Pass the SAME resolved locale the deal title/description
     use, normalized with `supportedLocaleOrDefault(...)`, as `contentLocale`. If you cannot
     cleanly extract the per-deal resolved locale, fall back to
     `supportedLocaleOrDefault(i18n.language)` — acceptable v1.
   - `app/deal/[id].tsx`: same; this screen has a per-deal language switch
     (`isAiV5DealLanguageSwitchEnabled`) — when the user switches the deal language, the poster
     must follow that switch, so use the switched locale, not raw `i18n.language`.
   - `app/(tabs)/wallet.tsx`, `components/map/map-native-screen.tsx`, `app/business/[id].tsx`:
     only if they render `ComposedAdCard` with a posterSpec — check each; thread the same way.
7. **`app/create/ai.tsx`** (LOCKED, minimal touch): pass
   `contentLocale={supportedLocaleOrDefault(i18n.language)}` to its `AdPosterCanvas` so the owner
   preview matches the owner's app language. This file has other uncommitted work — make the
   smallest possible diff.

## Tests

- `lib/runtime-env.test.ts`: add flag on/off assertions (copy existing pattern).
- `lib/poster/__tests__/posterPolicy.test.ts` (~line 263) tests `normalizePosterSpecForPublish`
  itself — that function still exists and is still used when the flag is off; the test should
  keep passing. Do not delete the function.
- Add a focused test for `posterCopyForLocale` selection + fallback (es-US missing → en-US).
- `components/poster/__tests__/AdPosterCanvas.test.ts` (LOCKED) contains source-level
  expectations — run it, update expectations minimally, update its lock hash too.
- Run `lib/composed-ad-card-parity-source.test.ts` and `lib/offer-version-publish.test.ts`;
  fix expectations only where they assert the en-US-only strip.

## Acceptance

- Flag off: `npm test` green with zero behavior change.
- Flag on (dev): same published deal shows `40% OFF` (en), `40% DE DESCUENTO` (es),
  `40% 할인` (ko) on the poster when switching app language; deal-detail language switch also
  switches the poster; a legacy spec containing only en-US still renders (fallback chain).
- Existing published posters remain English until re-published — expected; note it for Dan.
  (A service-role backfill script is deliberately OUT of this handoff; Dan decides later.)

---

# Phase 2 — Poster Look v2 (hidden flag)

## Flag

`EXPO_PUBLIC_POSTER_LOOK_V2` → `isPosterLookV2Enabled()` in `lib/runtime-env.ts` + snapshot +
tests. Flag off = current renderer untouched.

## Fonts (decision made — don't re-litigate)

- Latin (en/es): **Outfit_900Black** from the existing `@expo-google-fonts/outfit` package
  (zero new deps; matches the brand wordmark).
- Korean: **Black Han Sans** — add dependency `@expo-google-fonts/black-han-sans`
  (`BlackHanSans_400Regular`; it's a display-black Hangul face and includes Latin digits/% for
  the "40% 할인" badge). This is the only new dependency in the whole handoff.
- Load inside `AdPosterCanvas` with `useFonts` (same pattern as `app/auth-landing.tsx:222`).
  Until fonts load (or if loading fails), fall back to the current system `fontWeight: "900"`
  style — the poster must never render blank.
- Font pick at render: locale starts with `ko` → Black Han Sans, else Outfit Black.

## Visual spec (1080×1350 canvas, reuse existing `scale()`)

Implement as a `PosterContentV2` sibling of the existing `PosterContent`; switch on the flag in
one place. Do not edit the v1 constants or components.

Top block:
- Business name: size 30, letterSpacing ~3 (tracked caps feel), color `theme.business`, top 44.
- Eyebrow/kicker (owner preview only, when present): size 36, `theme.accent`, top 92.
- Headline: size 84, lineHeight 90, top 148, max 2 lines, display font, keep
  `adjustsFontSizeToFit` + `minimumFontScale={0.58}`.
- Top scrim: replace the heavy band with `["rgba(0,0,0,0.60)", "rgba(0,0,0,0.34)", "rgba(0,0,0,0)"]`,
  locations `[0, 0.14, 0.30]`.

Bottom block (the selling zone — offer first):
- Offer badge (offer_line_1, e.g. "40% OFF" / "40% DE DESCUENTO" / "40% 할인"): a centered
  rounded chip — background `theme.accent`, text `#221507` (or `theme.panelText` where darker),
  fontSize 56, paddingHorizontal 44, paddingVertical 16, borderRadius 999, no text shadow.
  Keep single-line auto-shrink (`adjustsFontSizeToFit`, `minimumFontScale={0.5}`) — Spanish
  badges are ~2× wider than English.
- offer_line_2: size 50, `theme.headline` (cream/white per template), margin-top 24.
- Schedule line: size 26, `theme.subline`, bottom area (~top 1290), unchanged content.
- Bottom scrim: `["rgba(0,0,0,0)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.86)"]`, locations
  `[0, 0.38, 1]`, starting at the same `POSTER_BOTTOM_BAND_TOP` — contrast under the text stays
  guaranteed, the photo mid-section stops being crushed.
- Text shadows: radius 6, alpha 0.35 (down from 12 / 0.56); none on the badge.

Keep untouched: template color themes (`POSTER_TEMPLATES`), sanitization/policy calls, aspect
ratio, accessibility label, `posterText()` uppercasing (data is uppercase anyway), the no-image
gradient background path.

## Files

- `components/poster/AdPosterCanvas.tsx` (LOCKED) — add `PosterContentV2` + font loading + flag
  switch.
- `components/poster/posterTemplates.ts` (LOCKED) — only if you need per-template accent-text
  colors for the badge; additive fields only.
- `lib/runtime-env.ts`, `lib/runtime-env.test.ts` — flag.
- `package.json` / lockfile — the one new font package.
- `components/poster/__tests__/AdPosterCanvas.test.ts` (LOCKED) — update source expectations.
- `docs/ai-poster-core-lock.json` — hash + approvalRef updates for every locked file touched.

## Acceptance

- Flag off: pixel-identical current look; `npm test` green.
- Flag on (dev build/emulator, Dan drives visual review): QA matrix = 3 languages × 3 templates
  × (photo, no-photo). Korean renders in Black Han Sans (not tofu boxes); Spanish badge fits on
  one line; headline never overlaps the badge zone; screenshots saved under a local `artifacts/`
  or QA folder only.

---

# Phase 1 runbook (Dan only — Sonnet: no action)

1. Publish the privacy/subprocessor paragraph from `docs/ai-google-data-flow.md` on the website.
2. Supabase Edge secrets: `GEMINI_API_KEY=<key>`, `AI_IMAGE_GEMINI_ENABLED=true`,
   `AI_IMAGE_PROVIDER=gemini`. Leave `GEMINI_IMAGE_MODEL` unset (defaults to
   `gemini-3.1-flash-image`) and `AI_IMAGE_FALLBACK_PROVIDER` unset (defaults to `openai`).
   Do NOT set `AI_TEXT_FALLBACK_ENABLED`.
3. QA: generate posters with/without an uploaded photo; check `ai_generation_costs` shows
   `provider: gemini`; image should fill the 4:5 canvas with no side-crop.
4. Restore: `AI_IMAGE_GEMINI_ENABLED=false`.

# Restore card

| Change | Restore |
|---|---|
| Gemini images | `AI_IMAGE_GEMINI_ENABLED=false` (secrets only) |
| Poster viewer language | Build without `EXPO_PUBLIC_POSTER_VIEWER_LANGUAGE_ENABLED` |
| Poster Look v2 | Build without `EXPO_PUBLIC_POSTER_LOOK_V2` |
| All code | Single branch; no migrations; no deploys; nothing in the DB depends on new code (multi-locale specs are additive and old builds ignore the extra locales) |

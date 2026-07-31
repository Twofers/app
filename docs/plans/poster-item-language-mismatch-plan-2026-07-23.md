# Poster vs deal-text language mismatch — diagnosis and fix plan (T6)

Date: 2026-07-23. Status: PLAN ONLY — no code changed. Extends `docs/plans/translate.md` (T0–T5).

## Symptom (device-verified, S10, Spanish shopper, `.dev` build via Metro)

Same business, same hour, two live deals:

- Standard-card deal text: **"Recibe 40% de descuento en 1 matcha de fresa"** (and 한국어 toggle: "딸기 말차 1잔 40% 할인") — item name translates. ✅
- Poster deal visual: **"40% OFF / STRAWBERRY MATCHA"** — fully English for the same Spanish viewer. ❌

So a Spanish customer can see the translated item name in one surface and English in the other — the mismatch this plan fixes.

## Diagnosis — three independent layers

### Layer 1 — publish-side collapse threw away the es/ko poster variants (why the poster is FULLY English)

- Generation builds poster `copy_by_language` for ALL three locales unconditionally ([posterCopy.ts:578](../../lib/poster/posterCopy.ts) `buildPosterCopyByLanguage` loops `SUPPORTED_LOCALES`).
- But at publish, [ad-spec.ts:335](../../lib/ad-spec.ts) gates on `posterViewerLanguageEnabled()` **read on the PUBLISHING device**: flag off → `normalizePosterSpecForPublish` ([posterCopy.ts:637](../../lib/poster/posterCopy.ts)) collapses `copy_by_language` to the source locale only (`{ "en-US": … }`).
- The 2026-07-23 09:15 poster deal was published from the rebuilt `.dev` APK whose embedded env pre-dated the eas.json flag fix → collapse ran → the stored/projected spec has **only en-US**.
- Viewer side then has nothing to pick: `posterCopyForLocale` falls back to en-US ([posterAdSpec.ts:39](../../lib/poster/posterAdSpec.ts)), regardless of the viewer flag being on.
- Evidence check: the poster showed English *scaffolding* ("40% OFF"), not Spanish scaffolding with an English item — consistent with "no es-US variant at all" (layer 1), not with a dictionary gap (layer 2).
- Specs are frozen at publish; that deal stays English forever (accepted — no legacy backfill).

**Fix for this layer: none in code.** Publish poster deals from a flag-on app (current Metro session qualifies; the APK after a rebuild with the already-edited `dev-apk-ai-studio` env). Production needs the flag in the production eas profile + rebuild before posters localize there (separate go/no-go, Dan's call).

### Layer 2 — the item-name expansion never reaches poster copy (the real text-vs-poster mismatch)

- Poster offer lines per locale are composed from `renderLocalizedOfferBundleFromDefinition(definition)[locale]` ([posterCopy.ts:435](../../lib/poster/posterCopy.ts)) and `resolveLocalizedOfferTerm` ([:376, :386](../../lib/poster/posterCopy.ts)) — **base dictionary only**.
- T2 (translate.md) deliberately excluded the expansion dictionary from the bundle entry point to keep publish artifacts byte-stable. Poster copy IS a publish artifact — so it inherited base-only coverage.
- Consequence: for any item covered only by the expansion ("strawberry matcha" → "matcha de fresa"/"딸기 말차"), even a correctly trilingual poster spec (layer 1 fixed) would say e.g. Spanish scaffolding + **English item name**, while the deal text says "matcha de fresa". Mismatch persists until this layer ships.

### Layer 3 — rollout/config gaps

- `dev-apk-ai-studio` eas profile lacked `EXPO_PUBLIC_POSTER_VIEWER_LANGUAGE_ENABLED` + `EXPO_PUBLIC_DEAL_ITEM_TRANSLATION_LOCALES` (+ `KOREAN_COUNTER_REGISTRY`) — FIXED in eas.json (uncommitted), takes effect on next APK build. `.env.development.local` covers Metro sessions today.
- The `production` eas profile has none of the three — production posters currently collapse at publish (fine until launch decision).
- Edge env has no `DEAL_ITEM_TRANSLATION_LOCALES` twin — required by layer-2 fix (server authors poster copy).

## The constraint that shapes the fix: four runtimes must agree byte-for-byte

`validatePosterSpecV1` **recomputes** the expected offer lines per locale from the offer definition and requires equality ([posterAdSpec.ts:132–138](../../lib/poster/posterAdSpec.ts) → `POSTER_OFFER_LINE_1/2_MISMATCH`). The same shared code runs in FOUR places:

1. Edge `ai-generate-ad-variants` — builds the draft at generation ([index.ts:4395](../../supabase/functions/ai-generate-ad-variants/index.ts), imports `lib/poster/posterCopy.ts` directly). 🔒 locked
2. Client preview build — [ai.tsx:3930](../../app/create/ai.tsx). 🔒 locked
3. Client publish build — [ai.tsx:4487](../../app/create/ai.tsx). 🔒 locked
4. Edge `publish-offer-version` — authoritative server-side re-validation ([index.ts:229](../../supabase/functions/publish-offer-version/index.ts)). 🔒 locked

If expansion participation were gated by ambient env in each runtime, ordinary version skew (app build vs edge deploy) would make builder ≠ validator → every poster publish hard-blocked. This repo has been bitten by exactly this class twice (approve/publish hash parity; R13 wording guard). The design must therefore carry the decision **inside the artifact**, not the environment.

## Fix design (T6): spec-recorded dictionary version

- Add `item_dictionary_version` to the poster spec (`PosterDraftV1`/`PosterSpecV1`): `0`/absent = base-only (today's behavior, and what every existing stored spec means); `1` = base + expansion v1 (`DEAL_ITEM_TRANSLATION_EXPANSION_VERSION`, already exported by T2).
- **Builders** stamp the version they used. Version choice comes from the locales switch (client: existing `dealItemTranslationLocales()` module; server: Deno env twin `DEAL_ITEM_TRANSLATION_LOCALES`).
- **Validators** never consult env: they recompute expected lines using the version **the spec declares**. A v0 spec validates as v0 anywhere forever (old deals safe); a v1 spec validates as v1 on any runtime that has the v1 dictionary. Env skew becomes harmless: worst case a stale builder emits v0 (English item names — today's behavior), never a publish block.
- Thread `extraDictionary` through `buildPosterOfferLinesFromOfferDefinition` → `renderLocalizedOfferBundleFromDefinition` as an explicit optional param; default absent → byte-identical output (the T2 baseline snapshot already proves the renderer default path; extend to poster lines).
- Client preview (site 2) and client publish (site 3) resolve the version through ONE shared helper so preview ≡ publish by construction.
- Viewer side: **no changes** — variants are baked per-locale; `AdPosterCanvas` already picks by viewer locale under the viewer flag.
- Unchanged invariants: merchant do-not-translate still wins (resolution order untouched); Korean counters remain reviewed-only (existing test enforces); base dictionary always beats expansion; deal facts never altered.

### Semantics change Dan must sign off on

For **posters**, the locales switch becomes **publish-time**: turning it off stops future posters from baking translated item names but does NOT un-bake published ones (specs are immutable). Deal-TEXT translation keeps its instant render-time on/off. If instant-off for posters is required, the alternative is render-time item substitution in the canvas — rejected here because it means string surgery on composed lines (fragile, and close to the "no example-specific string replacement" rule) and a heavier locked-file footprint in `AdPosterCanvas`.

## Files to change (each 🔒 needs Dan's explicit per-file approval before edit)

| File | Change | Locked |
|---|---|---|
| `lib/poster/posterCopy.ts` | Accept dictionary+version in line composition; stamp `item_dictionary_version`; keep `normalizePosterSpecForPublish` semantics | 🔒 |
| `lib/poster/posterAdSpec.ts` | Parse/persist the new field; validator recomputes with spec-declared version | no |
| `lib/localized-offer-renderer.ts` | Optional `extraDictionary` on the bundle entry point (default = today, byte-identical) | no |
| `app/create/ai.tsx` | Both build sites (:3930, :4487) pass version via one shared helper | 🔒 |
| `supabase/functions/ai-generate-ad-variants/index.ts` | Build draft with server-resolved version (env twin) | 🔒 |
| `supabase/functions/publish-offer-version/index.ts` | Version-aware validation (no env read) | 🔒 |
| `lib/ad-spec.ts` | Expected NO change (collapse gate unchanged) — listed for completeness | 🔒 |

Tests: extend `deal-item-translation-expansion.test.ts` with poster-line cases (es "matcha de fresa", ko "딸기 말차" + 잔 counter); `posterPolicy` cases for v0-validates-unchanged, v1-validates-with-expansion, and cross-version mismatch; a four-way parity test (preview build ≡ publish build ≡ client validator ≡ recompute) per locale × flag state; baseline snapshot stays untouched (proves default path byte-identical). Note: the T2 create-isolation guard scans `app/create/**` for DIRECT expansion imports — that stays true (participation is via `lib/` publish path); document the widened scope in the guard's comment.

## Skew-safe sequencing

1. **Land code everywhere with builders still emitting v0** (validators version-aware). Deploy both edge functions + rebuild app: zero behavior change, all runtimes now understand versions.
2. **Flip emission to v1**: dev = set the env twin on the edge project + Metro/.env flags (same day, both sides); production = only after the production rebuild carrying the version-aware validator is live, then edge env + production eas flags.
3. **Verify on device**: publish a fresh poster deal (flag-on business session), view as Spanish/Korean shopper → poster should read the translated item (e.g., "MATCHA DE FRESA" / "딸기 말차") AND match the deal text. Also verify a covered-by-base item (e.g., "coffee" → "CAFÉ") to isolate the viewer flag itself.

## Validation

Baseline (`typecheck`, `typecheck:functions`, `lint`, `npm test`), `gate:ai-poster-lock` (after per-file approvals + hash/approval-chain updates), `copy:evaluate` (poster copy path touched), new focused tests above, device QA per step 3. Edge deploys and any production flag changes are hard-gated — Dan executes/approves each.

## Open questions for Dan (before implementation)

1. Approve the five 🔒 files individually for the changes described above?
2. Accept the publish-time (bake) semantics for the poster half of the switch?
3. Production enablement timing for POSTER_VIEWER_LANGUAGE + item translation (separate from this fix landing)?

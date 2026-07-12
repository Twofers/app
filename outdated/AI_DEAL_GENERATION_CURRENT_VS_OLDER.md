# AI Deal Generation — Current (V4/V5) vs Older Version You Can Turn Back On

Audit date: 2026-07-07. Read-only analysis; no behavior changed by writing this file.
Purpose: give you one place to compare what the S10 dev build is doing now against the
older flow that production still runs, so you can decide what to ship.

---

## 0. The one thing to understand first

There are **two independent layers**, and only one of them is what "changed":

| Layer | What it does | Controlled by | Changed by the flags? |
|---|---|---|---|
| **Server generation pipeline** | research → copy → image → QA → localization. Runs in the `ai-generate-ad-variants` Edge Function. Produces **one** ad + copy alternatives + **one** image. | Supabase Edge **secrets** (hosted), not the app flags | **No.** Same work + same cost whether the app flags are on or off. |
| **Client presentation/UX** | the input form, the preview, the "options" you tap, the approve-before-publish gate, the poster look | `EXPO_PUBLIC_AI_V4_*` / `AI_V5_*` app flags (build-time) | **Yes.** This is the "current vs older" difference. |

So "current deal generation vs the older version" is almost entirely a **client presentation** difference. The expensive part (the model calls) is the same in both. The flags change what you *see and approve*, not what the server *spends*.

There is **no separate old generation endpoint** to revive: the legacy one-shot `ai-create-deal` function is permanently HTTP 410 (`AI_CREATE_DEAL_LEGACY_DISABLED`) and no longer contains a model/insert path (`docs/ai-ad-current-state.md`). "Turning the older version back on" means **turning the V4 app flags off**, which is exactly the config production already ships.

---

## 1. The three real configurations

The master gate is `composedAdPreviewEnabled = composed_ad_card OR shared_renderer OR authoritative_offer_card` (`app/create/ai.tsx:4133`). Every other V4 flag only takes effect when that is on.

| Tier | Where it runs today | `composedAdPreviewEnabled` | V4 interactive enhancements | What you get |
|---|---|---|---|---|
| **A — Current (full V4)** | S10 **dev** build, `preview`, `dev-client-apk` (`.env.development.local`, `eas.json`) | ✅ (composed card + shared renderer) | ✅ minimal input, instant style alternates, composite QA, exact-approval, presentation resolver | The new flow you're testing: fewer input fields, a composited poster card, "Try another style" options, must-approve-before-publish |
| **B — Older (production today)** | **production** EAS profile (`eas.json`) | ✅ (shared renderer only) | ❌ all off | Composited card preview, but **no** style options, **no** minimal input, **no** composite-QA gate, ad auto-accepted. This is "the older version." |
| **C — Classic (fully off)** | `apk` / `ios-sim` profiles, or all flags unset | ❌ | ❌ | Oldest path: raw copy + raw generated image preview, no shared-renderer card at all |

> Key point: **production is Tier B.** The S10 dev build is Tier A. You are comparing A (what you just tested) against B (what customers get today). Tier C is the oldest fallback if you want to strip the shared renderer too.

### 1.1 Exact flag values per profile (from `eas.json` + `.env.development.local`)

Current dev/S10 (Tier A) — ALL of these `=true`:
```
EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED=true
EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED=true
EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED=true
EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED=true
EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED=true
EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED=true
EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED=true
EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED=true
# + full V5 localization stack, + EXPO_PUBLIC_POSTER_LOOK_V2=true
```

Production (Tier B) — the V4 interactive flags are **absent/off**; only these are on:
```
EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED=true          # composited card, but nothing interactive
EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED=true
EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED=true
EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED=true
EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED=true
EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED=true
EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED=true
EXPO_PUBLIC_AI_V5_SOURCE_LOCALE_CREATIVE_ENABLED=true
EXPO_PUBLIC_AI_V5_PERSUASIVE_TRANSCRATION_ENABLED=true
EXPO_PUBLIC_AI_V5_TRANSLATION_QA_ENABLED=true
EXPO_PUBLIC_AI_V5_DETERMINISTIC_LANGUAGE_FALLBACK_ENABLED=true
EXPO_PUBLIC_AI_V5_LOCALE_PRESENTATION_OVERRIDES_ENABLED=true
EXPO_PUBLIC_AI_V5_LOCALE_SCREENSHOT_QA_ENABLED=false
EXPO_PUBLIC_AI_V5_AUTOMATIC_VERIFIED_BUNDLE_APPROVAL_ENABLED=true
```
Note: production is **more localized** (full V5) but has the **older, simpler create UX** (V4 off). Dev is the reverse on V4 and slightly lighter on V5.

---

## 2. The server generation pipeline (in depth) — SAME for both

File: `supabase/functions/ai-generate-ad-variants/index.ts` (+ `prompt.ts`, `_shared/*`).
This runs once per **Generate** tap. It is identical whether the app is Tier A or B.

### 2.1 Stages, models, budgets

| # | Stage | Provider / model | Output-token budget | Reasoning | Timeout | Logged as |
|---|---|---|---|---|---|---|
| 1 | **Auth + contract** | — | — | — | — | — |
| 2 | **Item research** | OpenAI `gpt-5.4-mini` (or web-search `gpt-4o-search-preview` when enabled) | 220 | low | 12–25s | `ad_research` |
| 3 | **Copy (5 variants + brief)** | OpenAI `gpt-5.4-mini` via shared router; prompt `AI_COPY_PROMPT_V5` | 1400 | **low** (was medium; fixed 2026-07-07) | 15s | `ad_copy` |
| 4 | **Image generate** | **Gemini `gemini-3.1-flash-image` first**, fallback **OpenAI `gpt-image-1`** | — | — | ~40–60s/call | `image_generation` |
| 5 | **Image QA** | Gemini `gemini-3.5-flash` vision, OpenAI vision fallback | — | low | 25s | `image_qa` |
| 6 | **Image regen (if QA fails an item)** | same provider, one retry | — | — | — | `image_generation_retry` |
| 7 | **Localization / transcreation** (es, ko) | OpenAI `gpt-5.4-mini` | 950 | **low** (fixed 2026-07-07) | 15s | `ad_localization_transcreation` |
| 8 | **Assemble + log** | — | — | — | — | `ai_generation_costs`, `ai_generation_logs` |

Model source of truth: `OPENAI_MODEL` Edge secret (currently `gpt-5.4-mini`; allowlist + default `gpt-5.5` in `_shared/openai-chat-model.ts`). Image allowlist in `_shared/dalle-image.ts` (gpt-image-2 removed — it hangs).

### 2.2 What it returns
**One** `SingleAd`: one `poster_storage_path` (one image) + `copy_alternatives` (up to 5 copy-only variants) + `variant_count` / `selected_variant_index` + localization bundle. The 5 "variants" are **copy**, not 5 images.

### 2.3 The image cost reality (measured on prod 2026-07-07)
Per Generate, the pipeline currently makes **~4 image calls for ONE final image** (~$0.26–0.41):
- Gemini generate (~$0.067) → item-QA fails → Gemini retry (~$0.067) → still fails QA →
- fall back to OpenAI `gpt-image-1` generate (~$0.128) + retry (~$0.128) → this is the image you keep.

On offers that name a required item (e.g. "free croissant"), Gemini's flash-image **reliably fails the item check**, so the Gemini pair (~$0.13) is spent and thrown away **every time** before OpenAI produces the real image. See §6 for the optimization.

### 2.4 Recent reliability fix (2026-07-07, committed `d9c16d73`, deployed)
`ad_copy`/transcreation on `gpt-5.4-mini` were returning empty content (reasoning ate the token budget) → dropped poster / worker-timeout → "no image." Fixed via reasoning-token headroom + medium→low reasoning + 12→15s timeout, and by keeping `gpt-image-2` out of the allowlist.

---

## 3. Current flow (Tier A — what you're seeing on the S10)

Client: `app/create/ai.tsx`. With the full V4 stack on:

1. **Minimal input flow** (`composedMinimalInputEnabled`, `ai.tsx:4138`) — streamlined entry; the full "revise" panel is hidden unless you're editing words (`showComposedRevisePanel`, `:4286`).
2. **Generate** → one call to `ai-generate-ad-variants` (the §2 pipeline, ~$0.40).
3. **Composed ad card preview** (`composedAdPreviewEnabled`, `:4133`) — the shared native renderer composites the poster (AI photo + text overlay of the selected copy) into the exact card customers will see.
4. **Presentation resolver** (`composedPresentationResolverEnabled`, `:4204` `resolveAdPresentation`) — picks the template/layout.
5. **Instant style alternates** (`composedInstantStyleAlternatesEnabled` → `canTryComposedStyle`, `:4285`) — **this is the "options" you saw.** They are re-composites of the **same one image** with different copy/template. Tapping one is **$0** — no new server call, no new image (confirmed: your publish was request `fb27e5ca`, 0 image calls, $0.00). The "different image" you noticed is the same base photo re-rendered with the chosen option's words/layout.
6. **Composite QA** (`composedCompositeQaEnabled`, `:3170`, `:3497`) — can **block** publish if the rendered card fails checks.
7. **Exact presentation approval** (`composedExactPresentationApprovalEnabled`, `:3318`, `:3454`) — you must approve the exact rendered card; `adAccepted` starts **false** and publish is blocked until the approved presentation matches.
8. **Publish** → `publish-offer-version` (versioned) + `send-deal-push`.

Net: more control, more guardrails, a WYSIWYG card, and a review/approve gate — at the cost of more UI steps.

---

## 4. Older flow (Tier B — production today, "turn back on")

Same server pipeline and same ~$0.40 image cost, but the client is simpler:

1. **Full input form** (no minimal-input streamlining).
2. **Generate** → same `ai-generate-ad-variants` call.
3. **Composited card preview** still renders (production keeps `SHARED_RENDERER=true`), **but**:
   - ❌ **No instant style alternates** — no "Try another style" options list.
   - ❌ **No presentation resolver** — default presentation only.
   - ❌ **No composite-QA publish gate.**
   - ❌ **No exact-approval gate** — `setAdAccepted(true)` immediately (`ai.tsx:3318`), so you can publish straight away.
   - Full revise panel is shown instead of the minimal one.
4. **Publish** → `publish-offer-version` + `send-deal-push`.

Tier C (strip `SHARED_RENDERER` too) drops the composited card entirely and shows the raw copy + raw generated image — the oldest look.

---

## 5. Side-by-side

| Capability | Current (Tier A, dev/S10) | Older (Tier B, production) |
|---|---|---|
| Server pipeline & model spend | Same (~$0.40/Generate) | Same (~$0.40/Generate) |
| Input UX | Minimal input flow | Full form |
| Preview | Composed WYSIWYG card | Composed card (shared renderer), fewer controls |
| "Try another style" options | ✅ yes (re-composite, $0) | ❌ no |
| Presentation/template resolver | ✅ yes | ❌ default only |
| Composite QA can block publish | ✅ yes | ❌ no |
| Must-approve-exact-card before publish | ✅ yes | ❌ auto-accepted |
| Poster Look v2 typography | ✅ on (dev) | ❌ off (prod) |
| V5 localization (es/ko owner UI, transcreation) | Partial | ✅ full |
| Publish path | `publish-offer-version` | `publish-offer-version` |
| Legacy `ai-create-deal` | 410 (dead) | 410 (dead) |

---

## 6. Cost & latency reality (measured, both tiers)

- **Per Generate:** ~$0.26–0.41, dominated by images. Text (research+copy+transcreation) ≈ $0.015.
- **Wasted spend:** the Gemini-first image pair (~$0.13) is discarded on item-based offers because it fails QA and falls back to OpenAI anyway.
- **Selecting an option / publishing:** **$0** (no regeneration).
- **Latency:** ~90–140s end-to-end; historically brushed the ~150s Edge worker limit (the double image-provider cycle is the main hog).

**Optimization worth analyzing:** set the image provider to **OpenAI-first** (or skip Gemini when the offer has a required visual item). Expected: **−~$0.13 and −~40s per Generate**, no quality loss, and more headroom under the 150s limit. This is a locked-config change (`_shared/dalle-image.ts` / image provider config) and would need your approval.

---

## 7. How to turn the older version back on

**In the dev build (to test Tier B on the S10):** edit `.env.development.local`, set the eight V4 interactive flags to `false` (keep `SHARED_RENDERER=true` to match production), then rebuild the dev client:
```
EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED=false
EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED=false
EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED=false
EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED=false
EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED=false
EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED=false
EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED=false
# leave EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED=true for Tier B, or =false for Tier C (oldest)
```
(These are read at bundle time, so a rebuild/restart of Metro is required — not a runtime toggle.)

**For production:** it already runs Tier B. Nothing to do to "keep" the older version. To *ship* the new (Tier A) version you would add the V4 flags to the `production` profile in `eas.json` and build.

No server redeploy or secret change is involved in any of this — it's purely which app build you install.

---

## 8. Open questions for your analysis

1. Is the WYSIWYG approve-gate + style options (Tier A) worth the extra steps for merchants, vs Tier B's faster publish?
2. The ~$0.13 wasted Gemini spend per Generate is independent of A/B — do you want the OpenAI-first optimization regardless?
3. Production is fully localized (V5) but on the older create UX (V4 off). If you ship V4, confirm the V5 localization + Poster Look v2 combination is validated together (dev currently runs a *partial* V5 set).
4. There is still no persisted server-side draft/variant review; both tiers select one ad client-side (see `docs/ai-ad-current-state.md` gaps).

---

## Source files
- Server: `supabase/functions/ai-generate-ad-variants/index.ts`, `prompt.ts`, `_shared/openai-chat-model.ts`, `_shared/dalle-image.ts`, `_shared/ai-localization-provider.ts`, `_shared/ai-text-provider.ts`
- Client: `app/create/ai.tsx`, `lib/runtime-env.ts`, `lib/functions.ts`
- Config: `.env.development.local`, `eas.json`, `constants/timing.ts`
- Docs: `docs/ai-ad-current-state.md`, `docs/ai-poster-core-lock.md`
- Cost data: `ai_generation_costs` (prod project `kvodhiqhdqnptqovovia`), view `ai_generation_cost_by_deal`

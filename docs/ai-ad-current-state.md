# AI Ad Current State Audit

Date: 2026-06-19
Branch: `codex/ai-ad-current-state-audit`
Safety checkpoint: `7ecad89e`
Plan source: `C:\Users\unvme\Downloads\TWOFER_AI_AD_GENERATION_MASTER_PLAN(1).md`

This is the Phase 0 audit requested by the master plan. It documents the current repository state only. No production behavior, schema, prompt, model, or runtime path was changed.

## Scope and Constraints

- Read first: `twofer-developer-handoff-spec.md` sections 1 through 5.
- Hard gates observed: no release build, submit, push, tag, branch reset, version change, signing change, deployment, or Supabase migration.
- Live Supabase data was not queried. This repo has no local Supabase, and this audit does not assume which drafted migrations are applied in production.
- Existing uncommitted work was present before this audit and was left untouched:
  - `app/create/ai.tsx`
  - `app/create/quick.tsx`
  - `lib/ad-variants.ts`
  - `lib/deal-offer-contract.test.ts`
  - `lib/deal-offer-contract.ts`
  - `lib/functions.ts`
  - `supabase/functions/ai-generate-ad-variants/index.ts`

## Executive Summary

The current app is not a naive one-prompt image generator. The main AI ad path already has meaningful guardrails:

- OpenAI calls happen in Supabase Edge Functions, not in the Expo client.
- The active ad generator uses JSON-schema copy output, a deterministic `DealOfferContract`, validation, one bounded repair attempt, and deterministic fallback copy.
- Main ad text is rendered in native UI; the active `ai-generate-ad-variants` image prompt explicitly asks for no text, logos, QR codes, or overlays.
- Cost logging exists in `ai_generation_costs`; generation audit logging exists in `ai_generation_logs`.
- Claim, QR, visual redemption, and release are server-side Edge Function flows.
- Database migrations include atomic max-claims enforcement and active-claim uniqueness guards, but live deployment state is not verified here.
- New AI Create and Quick create publishes now fail closed if an offer definition cannot be built and always use the `publish-offer-version` Edge Function. Existing-deal edit/update compatibility still writes directly to `deals`.

The biggest plan gap is architectural persistence. The current source of truth is still mutable `deals` plus `deal_claims`. There is no persisted `OfferDefinitionV1`, no immutable `offer_versions`, no durable `AdSpecV1`, and no `ad_generations` / `ad_variants` tables. The strongest contract today, `DealOfferContract`, is built transiently inside code and then flattened into the `deals` row at publish time.

One doc/code conflict: older docs such as `docs/twofer-ai-ad-mvp.md` expect exactly three visible ad options. The current implementation returns a single selected ad with `variant_count` and `selected_variant_index` metadata. Per repo rules, code wins; the audit treats the single-ad pipeline as current reality.

## Current Owner Offer Flows

### Full AI Create Flow

Files:

- `app/create/ai.tsx`
- `lib/functions.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/ai-generate-ad-variants/prompt.ts`
- `lib/deal-offer-contract.ts`

Flow:

1. Owner enters or prefills offer text, schedule, quantity, cutoff, locations, and structured eligibility fields.
2. Optional photo is uploaded to Supabase Storage bucket `deal-photos` under `<business_id>/...`.
3. Client invokes `ai-generate-ad-variants` with `business_id`, hint text, business context, output language, deal eligibility, optional `photo_path`, schedule summary, quantity limit, and redemption limit.
4. Edge Function authenticates the user, rejects redeemer-only sessions, verifies business ownership, validates eligibility, and builds a transient `DealOfferContract`.
5. Edge Function optionally researches the item, generates structured copy, validates against the contract, optionally repairs once, and falls back to deterministic copy when needed.
6. Edge Function either uses the uploaded original, enhances it, generates one image, or returns copy-only mode depending on request state.
7. Edge Function logs generation and cost metadata, then returns one `SingleAd`.
8. Owner must accept/review the ad. New publishes build an `OfferDefinitionV1` and native-renderer `AdSpecV1`, then call the `publish-offer-version` Edge Function. Existing-deal edit/update compatibility still writes the update directly to `deals`.
9. Client calls `send-deal-push` after publish/update best-effort.

Current strengths:

- Publish-time validation checks generated/edited copy against `DealOfferContract`.
- Strong-deal guard still blocks weak or broad offers.
- The owner must review and tap publish; there is no auto-publish in this path.

Current gaps:

- Offer facts are not persisted before model generation.
- The contract does not have a stable database identity or immutable version.
- Existing-deal edit/update compatibility still writes directly to `deals`; versioned edit semantics remain future data-model work.
- Hosted production still depends on the OfferVersion migrations and `publish-offer-version` Edge Function being deployed before new publishes can use the versioned path.
- Multi-location publish creates multiple `deals` rows, not one campaign with per-location offer versions.

### Quick Deal Express Flow

Files:

- `app/create/quick.tsx`
- `lib/ad-variants.ts`
- `lib/quick-deal-ad-validation.ts`

Flow:

1. Owner adds a hint and optional photo.
2. Client invokes `ai-generate-ad-variants`.
3. Quick drafts can request copy-only behavior when there is no photo, so they can succeed without image generation.
4. Client converts the returned ad into a draft, validates title/offer quality, previews, translates, builds an offer definition, publishes through `publish-offer-version`, and calls `send-deal-push`.

Current strengths:

- It reuses the main Edge generator.
- It has local quick-deal validation and publish blocking.

Current gaps:

- It does not persist a draft offer server-side before AI generation.
- Hosted production still depends on the OfferVersion migrations and `publish-offer-version` Edge Function being deployed before Quick publishes can use the versioned path.

### Menu-Driven Offer Flow

Files:

- `app/create/menu-manager.tsx`
- `app/create/menu-offer.tsx`
- `lib/menu-offer.ts`
- `supabase/migrations/20260429120000_business_menu_items.sql`

Flow:

1. Owners save or scan menu items into `business_menu_items`.
2. The menu offer wizard selects a main item, optional paired item, pairing type, size, and location.
3. It builds a structured offer and eligibility form state.
4. It hands off to `/create/ai` with prefilled hint, location, and `prefillDealEligibility`.

Current strengths:

- This is the closest existing path to the plan's "select verified facts before generation" requirement.
- It already routes fact selection into the main AI path instead of asking the model to infer everything.

Current gaps:

- `business_menu_items` is not yet a full catalog item contract. It lacks durable product asset ids, verified attributes, normal price cents, unit cost, image-rights attestation, and brand profile versioning.
- The selected facts are still flattened into the AI editor and then into `deals`.

### Legacy and Adjacent AI Paths

- `ai-compose-offer`: composes an offer from text/image/voice. Live text/photo offer composition now uses the shared OpenAI/Gemini structured text provider router, including router `imageInputs` for uploaded images. Legacy poster image generation is disabled; when `generate_poster_image` is requested the function returns compose copy with `poster_image_unavailable` and `poster_disabled_reason: "native_text_rendering_required"` instead of using `buildPosterImagePrompt`. Voice audio is processed ephemerally per the spec; transcript is logged. Missing OpenAI/Whisper configuration returns `OPENAI_KEY_MISSING` for transcription-only requests; text/photo compose can continue through Gemini only when the router flags and `GEMINI_API_KEY` are configured. Upstream Whisper, live compose provider, provider-config, and outer compose handler failures log only sanitized status/generic failure details, not raw provider response bodies or exception text.
- `ai-generate-deal-copy`: text-only copy helper used for business descriptions and onboarding suggestions. It now uses the shared OpenAI/Gemini structured text provider router with strict JSON schema. Missing provider configuration still fails closed with `OPENAI_NOT_CONFIGURED` unless the Gemini router path is enabled and configured, and provider/config failures return `AI_GENERATION_FAILED` or `AI_TEXT_CONFIG_INVALID` without raw provider response bodies or exception text.
- `ai-create-deal`: permanently disabled legacy one-shot AI plus insert endpoint. The Edge Function now returns `AI_CREATE_DEAL_LEGACY_DISABLED` with HTTP 410 and no provider, Supabase client, or `deals` insert path remains in the function source. The former `aiCreateDeal()` client wrapper was removed from `lib/functions.ts`.
- `ai-deal-suggestions`: owner dashboard insights helper. It now uses the shared OpenAI/Gemini structured text provider router. Missing provider configuration still returns `OPENAI_NOT_CONFIGURED` unless the Gemini router path is enabled and configured, and upstream generation/config failures return sanitized errors without raw provider response bodies or exception text.
- `ai-translate-deal`: localization helper used after deal creation and by direct callers. It now uses the shared OpenAI/Gemini structured text provider router. Missing provider configuration still returns `OPENAI_NOT_CONFIGURED` unless the Gemini router path is enabled and configured, and upstream generation/config/outer handler failures return sanitized errors without raw provider response bodies or exception text.
- `ai-extract-menu`: menu photo extraction path, relevant to catalog setup. The synthetic sample menu path is gated behind `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY=true`; production-style missing OpenAI config returns `OPENAI_NOT_CONFIGURED`, and upstream provider HTTP plus outer handler failures log sanitized status/error details instead of raw provider bodies or exception text.

## Current Data Model

Implemented or drafted entities:

- `businesses`: owner profile and business facts.
- `business_profiles`: billing/subscription profile data.
- `business_locations`: physical locations; `deals.location_id` points to one location.
- `business_menu_items`: owner-only saved menu items.
- `deal_templates`: reusable deal templates.
- `deals`: current canonical live offer/ad row.
- `deal_claims`: current claim, wallet, QR token/hash, redemption state, and claim telemetry row.
- `redemptions`: staff redemption-mode audit table.
- `deal_shares`: Share Deal records.
- `app_analytics_events`: product/funnel events.
- `ai_generation_logs`: AI generation audit, quota, prompt/model metadata, response payload.
- `ai_generation_costs`: private cost ledger with per-call model, endpoint, usage, estimated cost, request ids, success/errors. Ledger insert failures log fixed error codes rather than raw database exception text.

Missing plan entities:

- `merchant_brand_profiles`
- `catalog_item_assets`
- `offer_definitions`
- `offer_versions`
- `ad_generations`
- `ad_variants`
- `ad_assets`
- `prompt_versions`
- `quality_check_results`
- `merchant_edits`
- `publish_events`
- `ad_exposures`
- `consumer_feedback`
- `model_cost_events` as a named plan table, though `ai_generation_costs` is an equivalent cost ledger.

Current state machines:

- Offer/deal state is represented by `deals.is_active`, `deal_status`, `eligibility_status`, time fields, recurring fields, and claim counts.
- Generation state is synchronous. There is no persisted `queued -> validating -> generating_copy -> preparing_asset -> quality_check -> review_ready` state machine.
- Ad variant state is not persisted.
- Claim state is represented by `deal_claims.claim_status`: `active`, `redeeming`, `redeemed`, `expired`, `canceled`, `released`.

## Model Calls and Prompts

### Main Ad Generator

Function: `supabase/functions/ai-generate-ad-variants/index.ts`

Model and provider controls:

- Chat model is resolved from Edge secret `OPENAI_MODEL` through `resolveOpenAiChatModel()`.
- Allowlist: `gpt-4o-mini`, `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.4`.
- Default: `gpt-5.5`.
- Unsupported configured models throw `AI_TEXT_CONFIG_INVALID` instead of silently downgrading.
- Image models are resolved from Edge secrets through an allowlist in `_shared/dalle-image.ts`; OpenAI/Gemini image generation and edit HTTP failures and catch-path exceptions log sanitized status/error codes rather than raw upstream response bodies or free-form exception text.
- OpenAI API keys are read from Edge secrets only.

Stages:

- Research: `chat.completions`, normal chat model first and `gpt-4o-search-preview` when needed.
- Copy: shared structured text provider router with JSON schema; prompt version `AI_COPY_PROMPT_V4`; generator version `ai-copy-v4`.
- Image generation: `images.generations` using configured GPT image model.
- Image edit: `images.edits` for uploaded-photo enhancement.
- Image QA: shared structured provider router with `operation: "image_qa"`, image inputs, JSON schema, OpenAI primary, and Gemini fallback only when `AI_VISION_FALLBACK_ENABLED=true`.

Validation/fallback:

- `generateValidatedDealCopy()` validates against `DealOfferContract`.
- One repair attempt is allowed for invalid copy.
- Deterministic fallback copy is used if model request, parse, or validation fails.
- If image generation fails and no poster is produced, the call returns copy-only mode only when the request/policy permits that deterministic fallback path.

### Legacy Compose

Function: `supabase/functions/ai-compose-offer/index.ts`

- Uses Whisper for voice transcription when audio is supplied.
- Uses the shared OpenAI/Gemini structured text provider router for offer composition, with uploaded images carried through `imageInputs`.
- Does not generate legacy poster images; requested poster generation is marked unavailable so critical text stays rendered natively.
- Missing OpenAI configuration fails closed for transcription-only requests and for text/photo compose unless the Gemini router path is enabled and configured.
- Whisper and live compose provider failures return generic client errors and log only sanitized status/generic failure details, not raw provider response bodies.
- Logs to `ai_generation_logs` and `ai_generation_costs`.

### Text Copy Helper

Function: `supabase/functions/ai-generate-deal-copy/index.ts`

- Uses the shared OpenAI/Gemini structured text provider router with strict JSON schema for title, promo line, and description.
- Monthly limit defaults to 30 via `AI_COPY_MONTHLY_LIMIT`.
- Provider attempts are logged to server-side cost/error telemetry with sanitized error classes; raw provider bodies are not returned to clients, shared text-provider HTTP and fetch/parse exceptions use generic provider/code messages after local classification, and router/circuit-breaker maintenance failures log fixed error codes.
- Used by Account profile AI description and onboarding suggestions.

### Legacy One-Shot Insert

Function: `supabase/functions/ai-create-deal/index.ts`

- Permanently returns HTTP 410 with `AI_CREATE_DEAL_LEGACY_DISABLED`.
- Does not create signed URLs, call a model provider, create a Supabase client, or insert a live `deals` row.
- No current app code calls it, and the former exported client wrapper has been removed.

## Image Storage and Asset Handling

Storage:

- Bucket: `deal-photos`.
- Bucket is public-read so feeds can load posters through public object URLs.
- Owner uploads are scoped by policy to `<business_id>/...`.
- Generated/enhanced assets are uploaded server-side with service role into the same bucket.
- App prefers durable `poster_storage_path` and builds public URLs with `lib/deal-poster-url.ts`.

Current image behavior:

- Uploaded original photo can be used as-is.
- Uploaded photo can be enhanced with `touchup`, `cleanbg`, or `studiopolish`.
- No-photo ad generation uses a generated food/product image.
- Generated image QA checks required items for multi-item offers through the shared structured provider router, uses OpenAI vision first, can fall back to Gemini vision when `AI_VISION_FALLBACK_ENABLED=true`, and may regenerate once.
- The active ad image prompt forbids text, logos, labels, signage, overlays, and QR codes.

Gaps:

- No explicit EXIF/metadata stripping for owner uploads before storage.
- No local crop/resize/background-removal pipeline independent of OpenAI.
- Merchant preview has a deterministic native fallback visual for copy-only/no-image ads; there is still no server-side/static-share template renderer.
- No `catalog_item_assets` or `ad_assets` table tying original and generated assets to offer/ad versions.
- No OCR or logo-fidelity hard gate beyond prompt instruction and generated-image item QA.

## Claim, QR, Redemption, and Inventory Source of Truth

Primary files:

- `supabase/functions/claim-deal/index.ts`
- `supabase/functions/redeem-token/index.ts`
- `supabase/functions/begin-visual-redeem/index.ts`
- `supabase/functions/complete-visual-redeem/index.ts`
- `supabase/functions/release-claim/index.ts`
- `supabase/functions/_shared/claim-redeem.ts`

Current behavior:

- Claims are created server-side through `claim-deal`.
- Server checks deal active state, start/end time, claim cutoff, recurring window, repeat claim policy, one active wallet claim, and max claims.
- QR token is generated as an opaque `twofer://redeem/<uuid>` string. Newer schema stores `qr_token_hash` and returns raw token only to the claimant.
- Short code exists for manual staff redemption fallback.
- Redemption validates business ownership, location when present, claim status, expiration plus grace, and idempotently sets `redeemed_at`, `claim_status`, and audit fields.
- Visual redemption moves claims through `active -> redeeming -> redeemed`, with stale redeeming auto-finalization.
- Release moves active/redeeming claims to `released`.

Inventory/race protections:

- Migration `20260704130000_enforce_max_claims_atomic.sql` adds a trigger that locks the parent `deals` row and atomically enforces `max_claims` on `deal_claims` insert.
- Migration `20260705120002_deal_claims_unique_active.sql` adds per-user/per-deal active claim uniqueness.
- Migration `20260721120000_deal_wallet_redemption_rules.sql` adds a global one-active-wallet constraint.

Remaining gap:

- Claims and redemptions point to `deals.id`, not to immutable `offer_versions`. If a deal row is materially edited after claims exist, the historical claim has no separate immutable offer snapshot to reference.

## Telemetry, Analytics, Latency, and Cost

Implemented:

- `ai_generation_logs` stores prompt version, model, request type, success/failure, token counts, estimated cost for older paths, response payload, and generation telemetry.
- `ai_generation_costs` stores per-provider-call feature, model, endpoint, usage, estimated cost, OpenAI request id, response id, success/error, and request group id.
- Main ad telemetry includes structured offer fields, copy source, variant count, selected variant index, validation failure count, repair attempts, fallback use, image source, image QA, and copy latency.
- Consumer funnel events use `app_analytics_events`: `deal_viewed`, `deal_opened`, `deal_claimed`, `claim_blocked`, `wallet_opened`, `redeem_started`, `redeem_completed`, and `redeem_failed`.
- Dashboard code reads claims, redemptions, and daily deduped impressions.

Not measured in this audit:

- Current production p50/p95 latency.
- Current generation failure rate.
- Current fallback rate.
- Current real cost per generated or published ad.
- Merchant no-edit publish rate.
- End-to-end campaign funnel from generation to exposure to claim to redemption.

Reason: no live Supabase service-role analytics access was used, and this repo has no local Supabase. The code has the raw ledger needed for these measurements, but the audit cannot verify production rows.

Follow-up completed: `scripts/measure-ai-ad-baseline.mjs` now provides a read-only service-role runner and local dashboard-style Markdown export for these metrics, including provider fallback, judge usage, image QA, and merchant image-warning overrides. See `docs/ai-ad-baseline-metrics.md` for the access probe result, exact command, and remaining instrumentation gaps.

Google/Gemini data-flow follow-up: `docs/ai-google-data-flow.md` now documents the Gemini text fallback, independent judge, image generation/edit data flow, sensitive data exclusions, and the public privacy/subprocessor activation gate. Text fallback must remain hosted with `AI_TEXT_FALLBACK_ENABLED=false` until Dan approves and deploys the public privacy/subprocessor update.

Image QA fallback follow-up: generated and AI-edited image QA now uses the shared structured provider router with `operation: "image_qa"` and image inputs. It tries Gemini multimodal QA behind `AI_VISION_FALLBACK_ENABLED=true` after OpenAI vision failure. If both QA providers are unavailable, generated/AI-edited/stock paths still fail closed or fall back to safe copy-only/original behavior.

Recommended baseline queries once Dan grants live read access:

- p50/p95 copy latency from `ai_generation_logs.response_payload->copy->latency_ms`.
- p50/p95 total generation duration if added; total duration is not currently persisted as a first-class field.
- cost per request group from `ai_generation_costs`.
- fallback rate from `response_payload->copy->source = DETERMINISTIC_FALLBACK`.
- image failure/fallback rate from `response_payload->image_generation`.
- publish conversion by joining generation logs to `deals` is currently weak because there is no generation id on `deals`.

## Failure Modes Found

Critical architecture gaps:

- OfferDefinition/OfferVersion migrations and versioned publish code exist locally, but production application/deploy state is not verified here.
- New publishes can carry durable `AdSpecV1` through `publish-offer-version`; legacy rows and existing-deal edits are not fully AdSpec-driven.
- No `ad_variants` review state; the current generator selects one ad and returns metadata about variants rather than persisting reviewable variants.
- Versioned publish provides a server-side publish transaction for new deals when the migration/RPC is deployed; existing-deal edit/update compatibility remains outside that model.
- Claims and QR redemption do not reference the exact offer version the consumer claimed.

AI and quality gaps:

- Legacy `ai-create-deal` no longer contains a re-enableable generation-plus-insert path; it returns HTTP 410 only.
- Legacy `ai-compose-offer` poster mode is disabled so it cannot bake critical text into generated pixels.
- Main copy validation is strong for offer mechanics, but there is no full `AdQualityService` with persisted hard-gate results and soft scores.
- Vision QA for the ad-variant image path uses the shared provider abstraction, but it is still synchronous, flag-gated, and not persisted as a first-class quality-check result.
- Moderation is prompt/rule based; there is no dedicated moderation adapter.
- There is no formal prompt/model release table, canary mechanism, or rollback switch beyond code/env deployment.

Asset gaps:

- No upload metadata stripping.
- No full deterministic template library for native/share rendering; AI Create merchant preview now has a deterministic fallback visual for no-image ads.
- No visual snapshot or accessibility gate for ad templates.
- No asset ownership table linking catalog item, original photo, edited asset, and ad variant.

Operational gaps:

- Generation is synchronous; no persistent status, retry queue, or progress event stream.
- No generation id travels through publish, exposure, claim, and redemption.
- Generation requests do not carry a persisted idempotency key; new versioned publish requests do.
- Existing drafted migrations may or may not be applied live; production state requires a Supabase-side check.

UX/product gaps:

- The menu-driven flow collects more structured facts, but the general AI and Quick flows still allow free-text-heavy creation.
- Returning-merchant fast paths exist through templates/reuse, but not as an optimized "run again today" campaign workflow tied to learned winners.
- Merchant edits before publish are tracked as local/dev analytics events, not persisted as a structured `merchant_edits` dataset.

## Existing Baseline/Eval Assets

Existing assets:

- `fixtures/ai-promotional-copy-offers.json`: structured copy fixtures for offer mechanics.
- `scripts/evaluate-ai-promotional-copy.mjs`: deterministic headline evaluation over the fixture set.
- `docs/ai-ad-validation/`: manual validation scorecard and 12-case MVP test inputs.
- Unit tests in `lib/deal-offer-contract.test.ts`, `supabase/functions/ai-generate-ad-variants/prompt.test.ts`, `lib/ad-variants.test.ts`, and `lib/quick-deal-ad-validation.test.ts`.

Gaps against the master plan eval target:

- Existing fixture count is far below the plan's 250 structured scenarios and 75 visual scenarios.
- Current evals focus mostly on copy mechanics, not full AdSpec render, accessibility, image mismatch, OCR/watermark checks, or end-to-end publish/claim consistency.
- Manual validation docs are older than the current single-ad pipeline and still describe a three-option MVP.

## Phase Gap Matrix

### Phase 1 - Authoritative Offer Contract

Partially present:

- `DealOfferContract` provides transient structured mechanics and canonical lines.
- `deals` has eligibility columns for deal type, items, percentages, values, and statuses.
- Claim-side inventory and active-claim guards exist in migrations.

Missing:

- `OfferDefinitionV1` schema as a stable exported contract.
- Persisted offer definitions before model generation.
- Immutable offer versions.
- Claims and QR bound to offer version.
- Publish idempotency and server-side publish transaction.

### Phase 2 - Deterministic Ad Renderer and Safe Templates

Partially present:

- App renders text and CTA outside generated image in the main AI ad screen.
- `buildFallbackTemplateAd()` exists for local fallback ad copy.
- AI Create renders a deterministic native fallback visual for no-image merchant previews.
- Existing deal cards render poster plus native text.

Missing:

- AdSpec-driven feed/detail/claim renderer.
- Controlled template library with safe zones, dimensions, contrast, and long-text rules.
- Static social-share renderer from the same AdSpec.
- Visual snapshots and accessibility checks.
- Always-publishable no-AI ad from every valid offer across every surface.

### Phase 3 - Structured AI Copy and Creative Concepts

Partially present:

- Strict JSON schema for copy.
- Versioned prompt constant `AI_COPY_PROMPT_V4`.
- Five lane-based candidate variants in one response, with validated selection.
- Banned-claim/metadata-leak checks.
- Bounded repair and deterministic fallback.
- Per-call cost and metadata logging.

Missing:

- Persisted `CreativeBriefV1`.
- Persisted `CreativeConceptSetV1`.
- Merchant-facing three review variants.
- First-class generation status and total latency budgets.
- Full prompt/model release registry.

### Phase 4 - Product Asset Pipeline

Partially present:

- Owner-scoped upload policies.
- Uploaded original fallback.
- Optional image edit.
- Generated image item-presence QA for multi-item offers.
- One generated/enhanced asset reused for the returned ad.

Missing:

- Upload validation by file content.
- Metadata stripping.
- Crop/resize/background removal/color correction independent of provider.
- Original/logo asset overlay pipeline.
- Product mismatch QA test set.
- Asset tables and version links.

### Phase 5 - Quality, Eval, and Observability

Partially present:

- Mechanics hard gates in code.
- Cost ledger.
- AI generation logs.
- Funnel events and dashboard summaries.
- Copy fixture/eval script and unit tests.

Missing:

- Persisted hard-gate pipeline results.
- Soft scoring service.
- CI-blocking full eval suite for prompt/model/template changes.
- Hosted dashboards and alerts for p95 latency, cost anomalies, complaint spikes, hard-gate failure spikes, and provider health. A local read-only dashboard export exists through `scripts/measure-ai-ad-baseline.mjs`.
- Merchant edits as structured learning data.
- Prompt/model canary support.

## Smallest Next Vertical Slice

Goal: introduce authoritative offer contracts without changing customer-visible behavior.

Proposed slice:

1. Add a shared `OfferDefinitionV1` TypeScript contract and builder that is derived from existing `DealEligibilityFormState`, selected location, schedule, quantity, cutoff, and business/menu item facts.
2. Add deterministic `canonicalOfferSentence` and disclosure builder using existing `DealOfferContract` rules as the starting point.
3. Add focused unit tests for same-item BOGO, different-item free reward, percent-off single item, quantity, cutoff, and location disclosures.
4. Add a no-AI safe ad fallback builder that consumes `OfferDefinitionV1` and returns the current `GeneratedAd` shape, so the UI can publish without provider output.
5. Wire the full AI and Quick flows to build this object in memory before calling AI, but do not persist or migrate yet.

Why this slice first:

- It moves facts out of model output while avoiding a Supabase migration hard gate.
- It reuses current UI and `deals` publish paths.
- It gives tests a stable contract before adding `offer_definitions` and `offer_versions`.
- It creates the deterministic fallback needed for Phase 2 without redesigning the renderer yet.

Follow-up slice after approval:

- Draft migrations for `offer_definitions` and `offer_versions`, plus a server-side publish Edge Function that writes `deals` from an approved offer version. This will require explicit approval before applying any migration.

# Twofer AI Quality Implementation Report

## PR 1 - Provider foundation, cost, and resilience

Status: Partially implemented locally on branch `codex/ai-quality-pr1-provider-foundation`.

Safety checkpoint: `c6210777`.

Deployment actions: none.

Supabase migrations applied: none. Migration file added only; applying it is hard-gated for Dan approval.

Live secret names changed: none.

## Files added

- `supabase/functions/_shared/ai-provider-errors.ts`
- `supabase/functions/_shared/ai-structured-schema.ts`
- `supabase/functions/_shared/ai-cost-budget.ts`
- `supabase/functions/_shared/ai-provider-circuit-breaker.ts`
- `supabase/functions/_shared/ai-text-provider.ts`
- `supabase/functions/_shared/openai-text-provider.ts`
- `supabase/functions/_shared/gemini-text-provider.ts`
- `supabase/functions/_shared/openai-chat-model.test.ts`
- `supabase/functions/_shared/ai-text-provider.test.ts`
- `supabase/functions/_shared/ai-provider-circuit-breaker.test.ts`
- `supabase/functions/_shared/ai-cost-budget.test.ts`
- `supabase/migrations/20260727120000_ai_provider_circuit_breakers.sql`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## Files changed

- `supabase/functions/_shared/openai-chat-model.ts`
- `supabase/functions/_shared/ai-costs.ts`
- `supabase/functions/_shared/ai-costs.test.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`

## What landed

- `OPENAI_MODEL` now defaults to `gpt-5.5`.
- Unsupported OpenAI text models throw `AI_TEXT_CONFIG_INVALID` instead of silently falling back to `gpt-4o-mini`.
- GPT-5 family chat tuning now defaults to `reasoning_effort: "medium"` unless a caller explicitly overrides it.
- Added a provider-neutral structured text router for OpenAI and Gemini.
- Wired the `ai-generate-ad-variants` copy stage through the text router.
- Added Gemini text fallback for OpenAI quota, credit, billing, model availability, authentication, timeout, transient, and circuit-open classes when feature flags enable fallback.
- Preserved existing deterministic fallback behavior and existing copy validation/repair behavior.
- Added private provider-attempt telemetry in the ad generation payload and private cost-ledger rows.
- Added configurable cost-budget projection helpers.
- Added persistent circuit-breaker helper and a service-role-only migration.

## Feature flags

- `AI_V3_PROVIDER_ROUTER_ENABLED`
- `AI_V3_COST_BUDGET_ENABLED`
- `AI_CIRCUIT_BREAKER_ENABLED`
- Existing plan flags still pending in later slices:
  - `AI_V3_CREATIVE_PROFILE_ENABLED`
  - `AI_V3_FIVE_CANDIDATES_ENABLED`
  - `AI_V3_INDEPENDENT_JUDGE_ENABLED`
  - `AI_V3_MERCHANT_IMAGE_CONTROL_ENABLED`
  - `AI_V3_CUSTOM_IMAGE_EDIT_ENABLED`
  - `AI_V3_IMAGE_QA_ENABLED`
  - `AI_V3_IMAGE_QA_FAIL_CLOSED`
  - `AI_V3_IMAGE_SAFE_ZONE_ENABLED`

## Provider routing behavior

Primary text provider: OpenAI.

Primary model: `gpt-5.5`.

Fallback text provider: Gemini, model `gemini-3.5-flash`, when `AI_V3_PROVIDER_ROUTER_ENABLED=true` and `AI_TEXT_FALLBACK_ENABLED=true`.

Gemini judge model: resolver support is not fully wired to judging yet; judging belongs to PR 2.

Image provider routing: not changed in PR 1.

## Failover classes

Immediate fallback classes:

- `quota_exhausted`
- `insufficient_credits`
- `spend_limit_reached`
- `billing_hard_limit`
- `model_unavailable`
- `model_not_found`
- `authentication`
- `configuration`
- `circuit_open`
- `timeout`

Retry once, then fallback:

- `transient_rate_limit`
- `server_error`
- `network`

Provider output invalid:

- Preserved existing copy validator behavior by returning no variants so the existing corrective retry/fallback path runs.

## Cost and timeout controls

- Primary text timeout default: `AI_TEXT_PRIMARY_TIMEOUT_MS` or 12000 ms.
- Fallback text timeout default: `AI_TEXT_FALLBACK_TIMEOUT_MS` or 14000 ms.
- Full timeout does not retry OpenAI when `AI_RETRY_AFTER_FULL_TIMEOUT=false`; it falls back if fallback is enabled.
- Optional fallback can be blocked by hard budget projection when `AI_V3_COST_BUDGET_ENABLED=true`.
- Estimated cost is logged per provider attempt where available.

## Prompt versions

- Existing `AD_COPY_PROMPT_VERSION` remains `AI_COPY_PROMPT_V3`.
- PR 1 does not implement the PR 2 creative brief/five-lane prompt replacement.

## Tests added and results

Focused test run:

```text
npx vitest run supabase/functions/_shared/openai-chat-model.test.ts supabase/functions/_shared/ai-text-provider.test.ts supabase/functions/_shared/ai-provider-circuit-breaker.test.ts supabase/functions/_shared/ai-cost-budget.test.ts supabase/functions/_shared/ai-costs.test.ts
```

Result: 5 files passed, 25 tests passed.

Targeted Deno checks:

```text
deno check supabase/functions/_shared/ai-text-provider.ts
deno check supabase/functions/_shared/openai-text-provider.ts
deno check supabase/functions/_shared/gemini-text-provider.ts
deno check supabase/functions/_shared/ai-provider-circuit-breaker.ts
deno check supabase/functions/ai-generate-ad-variants/index.ts
```

Result: all passed.

Full validation:

```text
npm run typecheck
npm run typecheck:functions
npm run test
npm run lint
npm run copy:evaluate
npx expo export --platform android --output-dir "%TEMP%\twofer-metro-probe-codex-ai-pr1" --clear
```

Results:

- `npm run typecheck`: passed.
- `npm run typecheck:functions`: passed, 119 Edge Function files checked.
- `npm run test`: passed, 118 test files and 680 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid, 0 invalid, no changed facts.
- Metro bundle probe: passed, Android bundle exported to a temp folder. Existing `country-flag-icons` package export warnings appeared but did not fail the bundle.

## Acceptance criteria map

1. Live primary creative model resolves to `gpt-5.5`: Implemented.
2. Unsupported model names do not silently downgrade: Implemented.
3. Gemini 3.5 Flash configured as OpenAI availability/credit fallback: Implemented for ad-variant copy path behind flags.
4. OpenAI credit/quota failure falls back immediately: Implemented for routed copy path.
5. Full timeout does not cause a second full OpenAI wait: Implemented for routed copy path.
6. Persistent circuit breaker works across Edge Function instances: Partially implemented; migration/helper added, not applied or live-tested.
7. Per-stage provider/model/latency/token/cache/cost telemetry is stored: Partially implemented for routed copy attempts; cache fields depend on provider usage.
8. Configurable cost ceilings limit optional calls: Partially implemented for routed fallback projection.
9. Merchant receives preview or deterministic fallback, never blank: Preserved for copy path.
10-19. Creative quality ceiling criteria: Not implemented; PR 2.
20. Existing style-gate logic active in production path: Preserved, not newly expanded.
21. BOGO/2-for-1 shorthand blocked: Preserved by existing validators.
22. Immutable offer facts remain unchanged: Preserved.
23. Revisions pass same validation and judgment path: Partially implemented for routed copy revisions; independent judging pending.
24. Category playbooks active: Not implemented; PR 4.
25. Deterministic fallback usage and reason logged: Preserved and expanded with provider attempts.
26. Approval tied to exact final version: Preserved, not changed in PR 1.
27-46. Merchant image control and image quality criteria: Not implemented; PR 3.
47. Exact offer lines and terms from structured fields: Preserved.
48. Consumer feed/detail share authoritative helpers: Not implemented; PR 4.
49. Legacy canned output cannot appear as live AI: Not implemented in PR 1.
50. Google data flow documented before activation: Not implemented; activation should remain gated.
51. No generation/publish path bypasses router, offer contract, image selection, approval controls: Partially implemented; ad-variant copy path routed, other active text routes still direct.
52. No GPT-5.4-mini versus GPT-5.5 comparison performed: Implemented.

## Unresolved risks

- `ai-generate-deal-copy`, `ai-create-deal`, `ai-deal-suggestions`, `ai-compose-offer`, `ai-translate-deal`, and `ai-extract-menu` still call OpenAI directly.
- Image QA still uses OpenAI directly.
- Missing `OPENAI_API_KEY` still hard-stops `ai-generate-ad-variants` because research and image QA still depend on OpenAI in PR 1.
- The circuit breaker migration is written but not applied.
- Provider pricing values for future model IDs should be verified before production enablement.
- Privacy/subprocessor documentation must be updated before enabling Google text fallback in production.

## Rollback

Set these hosted flags/secrets without reverting schema:

```text
AI_V3_PROVIDER_ROUTER_ENABLED=false
AI_TEXT_FALLBACK_ENABLED=false
AI_V3_COST_BUDGET_ENABLED=false
AI_CIRCUIT_BREAKER_ENABLED=false
OPENAI_MODEL=gpt-5.4-mini
```

Do not roll back immutable offer validation, deterministic fallback copy, or exact-version merchant approval.

---

## PR 2 - Creative ceiling and copy quality

Status: Implemented locally on branch `codex/ai-quality-pr2-creative-ceiling`.

Safety checkpoint: `c19b13f3`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none. PR 2 uses a derived runtime Merchant Creative Profile from existing business context and offer facts. No Supabase migration was applied or created in this slice.

Live secret names changed: none.

## Files added

- `lib/ad-language-policy.ts`
- `lib/category-ad-playbooks.ts`
- `lib/merchant-creative-profile.ts`
- `lib/ad-candidate-diversity.ts`
- `lib/candidate-judge.ts`
- `lib/category-ad-playbooks.test.ts`
- `lib/merchant-creative-profile.test.ts`
- `lib/ad-candidate-diversity.test.ts`
- `lib/candidate-judge.test.ts`

## Files changed

- `tsconfig.json`
- `lib/ad-copy-style-gate.ts`
- `lib/deal-offer-contract.ts`
- `lib/deal-offer-contract.test.ts`
- `supabase/functions/ai-generate-ad-variants/prompt.ts`
- `supabase/functions/ai-generate-ad-variants/prompt.test.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added a centralized ad language policy for banned AI phrases, generic marketing phrases, hype patterns, vague local cliches, and BOGO/2-for-1 shorthand variants.
- Reused that policy in the prompt builder, offer-contract validation, style gate, and candidate judge helpers.
- Added category playbooks for coffee/cafe, bakery/dessert, restaurant/food, fitness/wellness, beauty/salon, local service, retail, and a conservative general-local fallback.
- Added a runtime Merchant Creative Profile helper derived only from existing merchant context, offer/research item context, broad location, and conservative category playbook facts.
- Unsafe claims such as best/rated/awards/certifications/health/dietary/guarantees/pricing are excluded from verified differentiators and prompt facts.
- Replaced the ad-copy schema with one `creativeBrief` plus exactly five strategy lanes:
  - `value_clarity`
  - `social_or_occasion`
  - `product_desire`
  - `local_discovery`
  - `merchant_specific`
- Increased copy generation output cap from 650 to 1400 tokens for the brief plus five candidates.
- Added candidate diversity hard checks for missing/duplicate lanes, unknown strategy IDs, identical normalized headlines, duplicate first-four-meaningful-word headline openings, and obvious paraphrases.
- Added warning-only Jaccard metrics for headline/body similarity.
- Wired the existing style gate into the `ai-generate-ad-variants` production copy path before final copy selection.
- Added deterministic preliminary scoring and candidate ranking.
- Added Gemini independent candidate judging behind `AI_V3_INDEPENDENT_JUDGE_ENABLED`.
- The judge receives immutable offer facts, category playbook, merchant profile, creative brief, and the strongest three valid candidates. It does not receive provider identity, deterministic score, or generation order.
- If Gemini generated the candidates, judging is skipped with `same_provider_fallback`.
- If the judge is disabled, unavailable, missing a Gemini key, or has too few valid candidates, deterministic ranking continues and the reason is logged.
- Added telemetry for creative brief, style-gate rejections, diversity hard failures/warnings, preliminary scores, judge decision, judge attempts, and judge fallback/skip reason.
- Preserved deterministic copy fallback, immutable offer validation, corrective retry behavior, and app-rendered locked offer/terms.

## Feature flags

- `AI_V3_INDEPENDENT_JUDGE_ENABLED`
- Rollback flags already available from PR 1:
  - `AI_V3_PROVIDER_ROUTER_ENABLED`
  - `AI_TEXT_FALLBACK_ENABLED`

The five-lane prompt and runtime Merchant Creative Profile are active in this local code path. The optional extra Gemini judge call is gated.

## Provider routing behavior

Creative generation and copy revisions continue through the PR 1 provider router.

Normal intended text generation path:

- Primary: OpenAI `gpt-5.5`, medium reasoning.
- Fallback: Gemini `gemini-3.5-flash` when PR 1 router/fallback flags are enabled.

Independent judge path:

- Provider: Gemini only.
- Model: `GEMINI_JUDGE_MODEL` resolved separately from `GEMINI_TEXT_MODEL`, defaulting to `gemini-3.5-flash`.
- Fallback: none; deterministic scoring is used when judging cannot run.

Image provider routing: not changed in PR 2.

## Cost and timeout controls

- Creative brief plus five candidates: `maxOutputTokens=1400`, `timeoutMs=12000`.
- Candidate judge: `maxOutputTokens=560`, `AI_JUDGE_TIMEOUT_MS` or 9000 ms.
- Judge attempts are logged to `ai_generation_costs` with feature `candidate_judge`.
- Provider attempts and estimated cost continue through the PR 1 text-router/cost path.

## Prompt versions

- `AD_COPY_PROMPT_VERSION`: `AI_COPY_PROMPT_V4`.
- `AI_COPY_GENERATOR_VERSION`: `ai-copy-v4`.
- `CANDIDATE_JUDGE_PROMPT_VERSION`: `candidate-judge-v1`.

## Tests added and results

Focused test run:

```text
npx vitest run lib/category-ad-playbooks.test.ts lib/merchant-creative-profile.test.ts lib/ad-candidate-diversity.test.ts lib/candidate-judge.test.ts lib/ad-copy-style-gate.test.ts lib/deal-offer-contract.test.ts supabase/functions/ai-generate-ad-variants/prompt.test.ts
```

Result: 7 files passed, 47 tests passed.

Current validation run:

```text
npx tsc --noEmit
npm run typecheck:functions
```

Results:

- `npx tsc --noEmit`: passed.
- `npm run typecheck:functions`: passed, 119 Edge Function files checked.

Full validation:

- `npm run typecheck`: passed.
- `npm run typecheck:functions`: passed, 119 Edge Function files checked.
- `npm run test`: passed, 122 test files and 692 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid, 0 invalid, no changed facts.
- Android Metro bundle probe passed:

```text
npx expo export --platform android --output-dir "%TEMP%\twofer-metro-probe-codex-ai-pr2" --clear
```

Existing `country-flag-icons` package export warnings appeared, matching the prior PR 1 probe, but did not fail the bundle.

## Acceptance criteria map

10. Merchant Creative Profile available and versioned: Implemented as a runtime derived profile, not persisted.
11. Unverified merchant claims excluded from prompts: Implemented for runtime profile facts/differentiators.
12. GPT-5.5 returns one positive creative brief and five candidates in one call: Implemented in schema/prompt; live provider behavior not run locally.
13. Five required creative lanes are present: Implemented by schema and diversity checks.
14. Hard duplicate checks active: Implemented.
15. Similarity heuristics logged for calibration: Implemented in copy quality telemetry.
16. Gemini judges GPT-5.5 candidates blindly: Implemented behind `AI_V3_INDEPENDENT_JUDGE_ENABLED`.
17. Gemini-generated fallback copy does not receive same-provider judgment: Implemented.
18. Selected candidate is specific to merchant when verified context exists: Partially implemented through prompt/profile/scoring; requires live non-publishing review.
19. Valid but forgettable candidate can be rejected even when facts are correct: Partially implemented through judge/scoring; requires live calibration.
20. Existing style-gate logic active in production path: Implemented for `ai-generate-ad-variants`.
21. Customer-facing BOGO/2-for-1 shorthand blocked: Implemented in centralized policy and offer validation.
22. Immutable offer facts remain unchanged: Preserved.
23. Revisions pass same validation and judgment path: Implemented for copy revisions in this path.
24. Category playbooks active: Implemented for copy prompt/judge context.
25. Deterministic fallback usage and reason logged: Preserved.
26. Approval tied to exact final version: Preserved, not changed in PR 2.
27-46. Merchant image control and image quality criteria: Not implemented; PR 3.
47. Exact offer lines and terms from structured fields: Preserved.
48. Consumer feed/detail share authoritative helpers: Not implemented; PR 4.
49. Legacy canned output cannot appear as live AI: Not implemented in PR 2.
50. Google data flow documented before activation: Not implemented; activation should remain gated.
51. No generation/publish path bypasses router, offer contract, image selection, approval controls: Partially implemented; PR 2 strengthens ad-variant copy only.
52. No GPT-5.4-mini versus GPT-5.5 comparison performed: Implemented.

## Unresolved risks

- Merchant Creative Profile is derived at runtime rather than persisted. A future data model can store confirmed profile facts, but no migration was applied in this PR.
- Targeted repair currently uses the existing whole-copy corrective retry path rather than regenerating only failed lanes.
- Independent judging is gated and has not been exercised against live Gemini in this local run.
- Generated copy quality still needs representative non-publishing merchant preview review before production enablement.
- Other legacy AI generation routes remain out of PR 2 scope.

## Rollback

Set:

```text
AI_V3_INDEPENDENT_JUDGE_ENABLED=false
AI_TEXT_FALLBACK_ENABLED=false
AI_V3_PROVIDER_ROUTER_ENABLED=false
OPENAI_MODEL=gpt-5.4-mini
```

If the five-lane prompt must be rolled back before PR 4 cleanup, redeploy the prior Edge Function version from PR 1. Do not roll back immutable offer validation, deterministic fallback copy, or exact-version merchant approval.

---

## PR 3 - Merchant image control and source-aware QA

Status: Implemented locally on branch `codex/ai-quality-pr3-image-control`.

Safety checkpoint: `f1b491c8`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none. PR 3 stores image-selection provenance in the existing generated-ad response, telemetry payload, and versioned publish `ad_spec`; no database migration was applied or created.

Live secret names changed: none.

## Files added

- `lib/image-asset-lineage.ts`
- `lib/merchant-image-selection.ts`
- `lib/merchant-image-edit-policy.ts`
- `lib/merchant-image-selection.test.ts`
- `lib/merchant-image-edit-policy.test.ts`

## Files changed

- `app/create/ai.tsx`
- `lib/ad-spec.ts`
- `lib/ad-variants.ts`
- `lib/functions.ts`
- `lib/offer-version-publish.test.ts`
- `lib/quick-deal-image-qa.ts`
- `lib/quick-deal-image-qa.test.ts`
- `supabase/functions/_shared/dalle-image.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added canonical image source modes: `merchant_original`, `merchant_ai_edit`, `ai_generated`, `approved_stock`, and `deterministic_fallback`.
- Added canonical edit modes: `none`, `touchup`, `clean_background`, `studio_polish`, and `custom`.
- Added image-selection and lineage helpers so generated ads can carry selected storage path, source photo path, provider, model, prompt version, QA decision, and derivative lineage.
- Added a conservative merchant custom-edit instruction policy that blocks requests to add text/logos/QR/prices, change offer items/counts/terms, request third-party brands, or introduce distracting characters.
- Expanded image QA into source-aware decisions:
  - merchant originals can produce warnings and an acknowledgement path.
  - generated, AI-edited, and approved-stock assets block on missing required items or forbidden elements.
  - generated and AI-edited assets fail closed when vision QA is unavailable.
- Wired the app's existing "use actual photo as final" versus polish control into `image_source_mode` and `image_edit_mode` request fields.
- Preserved backward compatibility with legacy `photo_path` and `photo_treatment` callers.
- Added edge response field `image_selection` and logged `image_selection` plus `image_lineage` in `ai_generation_logs.response_payload`.
- QA-checks AI-edited merchant-photo derivatives before upload selection. If edited QA blocks or is unavailable, the server falls back to the merchant original or provider fallback.
- Generated image QA now fails closed on QA outage instead of uploading unchecked generated imagery.
- Approved-stock fallback is tagged as its own source rather than inheriting generated-image QA failure metadata.
- Versioned publish `ad_spec` now carries the selected image provenance. If the merchant publishes the original uploaded photo as final, the ad spec follows that exact selected path.
- Tightened the OpenAI image prompt to match Gemini's forbidden-elements policy for text, prices, coupons, menu boards, QR/barcodes, fake logos, watermarks, mascots, animals, and unrelated characters.

## Provider routing behavior

- Image provider order remains unchanged: Gemini image primary when configured, OpenAI fallback when configured, then approved-stock/copy-only fallback.
- OpenAI remains the vision QA provider. PR 3 did not add Gemini vision QA fallback.
- Text provider routing from PR 1/PR 2 is unchanged.

## Tests added and results

Focused tests added:

- `lib/merchant-image-selection.test.ts`
- `lib/merchant-image-edit-policy.test.ts`
- source-aware cases in `lib/quick-deal-image-qa.test.ts`
- image-selection ad-spec assertion in `lib/offer-version-publish.test.ts`

Full validation:

- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 119 Edge Function files checked.
- `npm run test -- --run`: passed, 124 test files and 701 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid, 0 invalid, no changed facts.
- Android Metro bundle probe passed:

```text
npx expo export --platform android --output-dir "%TEMP%\twofer-metro-probe-codex-ai-pr3-<id>"
```

Existing `country-flag-icons` package export warnings appeared, matching prior probes, but did not fail the bundle.

## Acceptance criteria map

26. Approval tied to exact final version: Implemented for generated-ad response, telemetry, and versioned publish `ad_spec`.
27. Merchant image choice authoritative: Implemented for original-vs-edit-vs-generated request intent.
28. Original merchant uploads remain selectable: Implemented.
29. AI edits are derivatives with lineage: Implemented in response/ad_spec metadata; no new DB table.
30. Generated images are clearly source-tagged: Implemented.
31. Approved stock remains distinct from generated fallback: Implemented.
32. Deterministic fallback remains available: Preserved and source-tagged.
33. Source-aware QA schema exists: Implemented in shared helper types/results.
34. Merchant originals use warning/override semantics: Implemented in helper and publish snapshot metadata.
35. Generated/AI-edited fail closed on hard QA failures: Implemented.
36. Generated/AI-edited fail closed on QA outage: Implemented.
37. Required visual items checked for generated/edited images: Implemented through existing vision QA with source-aware decisions.
38. Forbidden visual elements checked: Implemented and prompt wording expanded.
39. Merchant custom edit instructions constrained: Implemented helper and edge rejection for invalid custom instructions.
40. UI exposes upload/use-original/polish controls: Partially implemented through existing controls; no new custom-edit text UI.
41. Undo/restore controls: Not implemented in PR 3.
42. Provider order Gemini image primary/OpenAI fallback preserved: Implemented.
43. Gemini vision QA fallback: Not implemented in PR 3.
44. Image provenance persists: Partially implemented in `ad_spec`/telemetry; no dedicated DB lineage table.
45. Exact selected image asset in publish audit: Implemented in versioned publish `ad_spec`.
46. No unchecked generated image becomes publishable: Implemented for this ad-variant image path.
47-52. Later non-image cleanup criteria: Not implemented in PR 3.

## Unresolved risks

- No Supabase migration was applied or created for a dedicated image-selection or image-lineage table. Provenance is stored in existing JSON payloads only.
- Gemini vision QA fallback remains pending; OpenAI vision QA outage sends generated/edited imagery to fallback rather than a second QA provider.
- The app has no custom image edit text box yet, though the server policy is in place.
- Merchant-original warning acknowledgement is represented by the existing "use actual photo as final" choice, not by a separate warning modal.
- Local validation did not perform live provider calls or publish a real deal.

## Rollback

Redeploy the PR 2 `ai-generate-ad-variants` Edge Function and mobile build if image-selection metadata causes issues. No migration rollback is required for PR 3.

---

## PR 4a - Legacy compose-offer canned-output cleanup

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `bb91ec7c`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `supabase/functions/_shared/ai-compose-offer-source.test.ts`

## Files changed

- `supabase/functions/ai-compose-offer/index.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed the legacy generated-looking canned response from `ai-compose-offer` when `OPENAI_API_KEY` is missing.
- The missing-key path now logs a failed `compose_offer` generation with `failure_reason: "OPENAI_KEY_MISSING"` and `result_source: "unavailable"`.
- The function now returns a controlled `503` response with `error_code: "OPENAI_KEY_MISSING"` and quota metadata instead of `ok: true` ad variants.
- Added a source guard test to prevent the old canned copy strings or a demo-generation flag from returning.

## Tests added and results

Focused validation:

- `npx vitest run supabase/functions/_shared/ai-compose-offer-source.test.ts`: passed, 1 file and 1 test.
- `npm run typecheck:functions -- --pretty false`: passed, 120 Edge Function files checked.

Full validation:

- `npx tsc --noEmit --pretty false`: passed.
- `npm run test -- --run`: passed, 125 files and 702 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 valid fixtures and 0 invalid fixtures.
- Android Metro probe, `npx expo export --platform android --output-dir <temp>`: passed. Existing `country-flag-icons` package export warnings appeared.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Implemented for the `OPENAI_API_KEY` missing path in `ai-compose-offer`.
51. No generation path bypasses provider/quality controls: Partially improved; this slice removes the pass-open canned fallback, but `ai-compose-offer` still uses its legacy direct OpenAI call for the live path.
47-48, 50, 52. Broader deterministic rendering, privacy documentation, and final cleanup criteria: Not implemented in PR 4a.

## Unresolved risks

- `ai-compose-offer` still uses a legacy direct OpenAI chat-completions call for normal live generation.
- Privacy/subprocessor documentation for Gemini text fallback remains a release-gated documentation task.
- Authoritative consumer rendering helpers and internal quality/cost dashboards remain pending PR4 work.

## Rollback

Revert this commit or redeploy the PR 3 version of `ai-compose-offer`. No migration rollback is required.

---

## PR 4b - Authoritative consumer deal rendering helpers

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `bd0c7210`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `lib/deal-feed-schema.test.ts`

## Files changed

- `lib/deal-display-copy.ts`
- `lib/deal-display-copy.test.ts`
- `lib/deal-feed-schema.ts`
- `lib/deal-localization.test.ts`
- `lib/deals-discovery-filters.ts`
- `lib/deals-discovery-filters.test.ts`
- `app/(tabs)/index.tsx`
- `app/(tabs)/wallet.tsx`
- `app/business/[id].tsx`
- `app/deal/[id].tsx`
- `components/map/map-native-screen.tsx`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- `getDealDisplayTitle` now prefers locked offer lines when present, then renders from structured deal facts before falling back to legacy title cleanup.
- `getDealDisplayDescription` now prefers locked terms/disclosure lines when present.
- Same-item, reward-item, percent-off, quantity, and size/modifier display cases now render deterministically from structured fields.
- Consumer home feed, deal detail, wallet, business profile deal list, and map deal preview now try structured display columns first and fall back to the previous base select if staged columns are missing.
- Consumer search now includes structured item fields so exact required/reward items are searchable even when old title prose is vague.
- Added unit coverage for locked lines, structured quantity rendering, select fallback detection, localization override behavior, and structured search fields.

## Tests added and results

Focused validation:

- `npx vitest run lib/deal-display-copy.test.ts lib/deal-localization.test.ts lib/deals-discovery-filters.test.ts lib/deal-feed-schema.test.ts`: passed, 4 files and 38 tests.
- `deno check supabase/functions/ai-create-deal/index.ts`: passed.
- `deno check supabase/functions/deal-link/index.ts`: passed.
- `deno check supabase/functions/send-deal-push/index.ts`: passed.

Full validation:

- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: timed out twice locally, once after 2 minutes and once after 5 minutes, with no failure output. Targeted Deno checks for the Edge Functions that import `lib/deal-display-copy.ts` passed.
- `npm run test -- --run`: passed, 126 files and 712 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 valid fixtures and 0 invalid fixtures.
- Android Metro probe, `npx expo export --platform android --output-dir <temp>`: passed. Existing `country-flag-icons` package export warnings appeared.

## Acceptance criteria map

47. Exact offer lines and terms come from structured fields: Implemented for locked/ad-spec fields when supplied and for deal structured columns on consumer surfaces.
48. Consumer feed and detail surfaces share authoritative helpers: Implemented through `localizedDealTitle`/`localizedDealDescription` backed by `getDealDisplayTitle`/`getDealDisplayDescription`; home feed and detail now fetch structured display fields with safe fallback.
49. Legacy canned output cannot appear as live AI: Already improved in PR 4a; no additional change in PR 4b.
50. Google data flow is documented before activation: Not implemented in PR 4b.
51. No generation or publish path bypasses provider/contract/image/approval controls: Partially improved on consumer rendering only; broader generation/publish bypass audit remains pending.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Unresolved risks

- Full `npm run typecheck:functions` did not complete locally; targeted Deno checks passed for the affected Edge Function importers.
- Structured consumer rendering still depends on the staged structured deal columns being present in Supabase. The app falls back to legacy base selects if those columns are missing.
- Terms rendering is improved where locked terms are available; older legacy deals without structured/locked terms still rely on legacy descriptions plus the existing schedule/cutoff lines.
- Privacy/subprocessor documentation, internal quality/cost dashboards, and broader generation/publish bypass cleanup remain pending PR4 work.

## Rollback

Revert this commit. No migration rollback is required.

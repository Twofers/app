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

---

## Composed Ad Card PR 1 - Shared renderer and English authoritative card

Status: Implemented locally on branch `codex/composed-ad-card-pr1`.

Safety checkpoint: `9fda6598`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `lib/ad-presentation-spec.ts`
- `lib/ad-presentation-hash.ts`
- `lib/ad-render-content.ts`
- `lib/ad-theme-tokens.ts`
- `lib/authoritative-offer-renderer.ts`
- `lib/ad-presentation-spec.test.ts`
- `lib/ad-presentation-hash.test.ts`
- `lib/authoritative-offer-renderer.test.ts`
- `components/composed-ad-card/ComposedAdCard.tsx`
- `components/composed-ad-card/AdAccessibilityText.tsx`
- `components/composed-ad-card/AdBrandRow.tsx`
- `components/composed-ad-card/AdCallToAction.tsx`
- `components/composed-ad-card/AdHeadline.tsx`
- `components/composed-ad-card/AdImageLayer.tsx`
- `components/composed-ad-card/AdStatusBadges.tsx`
- `components/composed-ad-card/AdSupportingCopy.tsx`
- `components/composed-ad-card/LockedOfferLine.tsx`
- `components/composed-ad-card/types.ts`
- `components/composed-ad-card/templates/HeroImageOverlayTemplate.tsx`
- `components/composed-ad-card/templates/SplitOfferPanelTemplate.tsx`
- `components/composed-ad-card/templates/LiveDropCardTemplate.tsx`

## Files changed

- `app/create/ai.tsx`
- `app/(tabs)/index.tsx`
- `app/deal/[id].tsx`
- `lib/runtime-env.ts`
- `lib/runtime-env.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added a bounded `AdPresentationSpec` contract with PR 1 template IDs, theme IDs, image source types, crop/focal clamping, validation, and renderer/spec version constants.
- Added the English authoritative offer renderer that builds native locked offer content from `OfferDefinitionV1`, `DealOfferContract`, or existing deal display fields, and rejects `BOGO` / `2-for-1` style shorthand for customer-facing locked text.
- Added a stable presentation hash that covers approved image/presentation/copy/locked-offer inputs and deliberately excludes live quantity and countdown state.
- Added bounded theme tokens and renderer-facing content types for merchant identity, approved copy, immutable offer facts, and live state.
- Built the shared native `ComposedAdCard` renderer with `hero_image_overlay`, `split_offer_panel`, and `live_drop_card`; unsupported/fallback/risky cases fail closed to `split_offer_panel`.
- Wired merchant AI preview to the shared renderer behind `AI_V4_COMPOSED_AD_CARD_ENABLED`, `AI_V4_SHARED_RENDERER_ENABLED`, or `AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED`.
- Wired customer Home feed and Deal Detail to the same renderer behind `AI_V4_SHARED_RENDERER_ENABLED`; flags default off, so existing production surfaces remain unchanged until enabled.
- Added public Expo aliases for the client-side flags: `EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED`, `EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED`, and `EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED`.

## Renderer version

- Presentation spec version: `twofer-ad-presentation-v1`
- Renderer version: `twofer-composed-card-renderer-v1`
- Authoritative offer renderer version: `twofer-authoritative-offer-en-v1`

## Templates implemented

- `hero_image_overlay`
- `split_offer_panel`
- `live_drop_card`

Deferred to PR 2: `social_moment_card`, `local_discovery_card`, `signature_item_card`, deterministic resolver, style alternates, and merchant style switching.

## Deterministic resolver behavior

PR 1 does not implement the full resolver. The renderer accepts a bounded presentation spec and fails safely:

- `live_drop_card` renders only for live deals.
- `hero_image_overlay` renders only when a real image source is present.
- deterministic fallback and unsupported template requests render as `split_offer_panel`.

## Presentation hash behavior

- Hash covers image asset ID, crop/focal point, template, theme, logo/supporting-copy visibility, headline, supporting copy, CTA, locked offer line, terms line, spec version, and renderer version.
- Hash excludes live quantity, countdown, and schedule display state.

## Safe-zone and crop behavior

- PR 1 stores bounded crop/focal metadata and clamps it to the 0-1 image coordinate space.
- Full image safe-zone detection and crop repair are deferred to PR 2.
- Merchant originals are not modified; crop/focal values are presentation metadata only.

## Merchant first-preview flow

- Existing flow remains unchanged with flags off.
- With composed-card flags on, the AI preview uses the same `ComposedAdCard` renderer and the exact locked offer content.
- No new mandatory merchant input was added.

## Style-switch behavior

- Not implemented in PR 1. Deferred to PR 2.

## Composite QA triggers and outcomes

- Not implemented in PR 1. Deterministic composite QA and selective screenshot QA are deferred to PR 3.

## Approval and publish enforcement

- Existing publish behavior is preserved.
- Exact presentation approval binding and server-side publish enforcement are deferred to PR 3.

## Representative screenshots and real-device findings

- Not captured in this local PR 1 pass.
- Real iPhone testing remains out of scope on this Windows machine.

## Metrics

- Telemetry for renderer usage, repairs, approval, and style edits is deferred to PR 2/3.

## Validation

- `npx tsc --noEmit --pretty false`: passed.
- `npx vitest run lib/authoritative-offer-renderer.test.ts lib/ad-presentation-spec.test.ts lib/ad-presentation-hash.test.ts lib/runtime-env.test.ts`: passed; 4 files, 12 tests.
- `npx vitest run`: passed; 143 files, 794 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npx expo lint`: passed.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-composed-pr1" --clear`: passed. Existing `country-flag-icons` package export warnings appeared, matching prior probes.
- `npm run copy:evaluate`: passed; 30 valid, 0 invalid.
- `npm run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.

## Unresolved risks

- The composed renderer is flag-gated and not enabled by default.
- Customer feed/detail adapters derive display facts from currently selected deal rows; richer versioned `ad_spec` customer loading remains future work after the relevant Supabase-side rollout.
- PR 1 intentionally does not add database fields, migrations, full resolver, style switching, composite QA, screenshot QA, or publish enforcement.

## Rollback

Set the rollout flags false/unset:

- `AI_V4_COMPOSED_AD_CARD_ENABLED=false`
- `AI_V4_SHARED_RENDERER_ENABLED=false`
- `AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED=false`

No migration rollback is required.

---

## Composed Ad Card PR 2 - Resolver, safe zones, and merchant style controls

Status: Implemented locally on branch `codex/composed-ad-card-pr2`.

Safety checkpoint: `d667af2d` (Composed Ad Card PR 1 commit).

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `lib/image-safe-zone.ts`
- `lib/ad-crop-resolver.ts`
- `lib/ad-text-fit.ts`
- `lib/ad-template-resolver.ts`
- `lib/image-safe-zone.test.ts`
- `lib/ad-crop-resolver.test.ts`
- `lib/ad-text-fit.test.ts`
- `lib/ad-template-resolver.test.ts`
- `components/composed-ad-card/templates/SocialMomentTemplate.tsx`
- `components/composed-ad-card/templates/LocalDiscoveryTemplate.tsx`
- `components/composed-ad-card/templates/SignatureItemTemplate.tsx`

## Files changed

- `app/create/ai.tsx`
- `components/composed-ad-card/ComposedAdCard.tsx`
- `lib/runtime-env.ts`
- `lib/runtime-env.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added deterministic image safe-zone, crop repair, text-fit, and presentation-template resolver helpers.
- Added renderer templates for `social_moment_card`, `local_discovery_card`, and `signature_item_card`.
- Wired the merchant AI preview to use the resolver behind `AI_V4_PRESENTATION_RESOLVER_ENABLED` / `EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED`.
- Added default-off minimal preview controls behind `AI_V4_MINIMAL_INPUT_FLOW_ENABLED` / `EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED`: Change photo, Change words, and Try another style.
- Added instant style cycling behind `AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED` / `EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED`; it changes only native presentation metadata and does not call AI.
- Preserved the existing generated preview and revise flow with all new flags off.

## Resolver behavior

- Clean usable images can select live, hero, social, local, or signature templates and expose up to two deterministic alternates.
- Low-confidence, blocked, missing, unavailable, or deterministic-fallback image paths fail closed to `split_offer_panel`.
- Text-fit repairs can use compact offer lines, hide supporting copy, or switch to the split panel before any unsafe layout is rendered.
- Crop/focal metadata stays bounded in 0-1 image coordinates; merchant originals are not modified.

## Validation

- `npx tsc --noEmit --pretty false`: passed.
- `npx vitest run lib/image-safe-zone.test.ts lib/ad-crop-resolver.test.ts lib/ad-text-fit.test.ts lib/ad-template-resolver.test.ts lib/runtime-env.test.ts`: passed; 5 files, 16 tests.
- `npx vitest run`: passed; 147 files, 807 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npx expo lint`: passed.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-composed-pr2" --clear`: passed. Existing `country-flag-icons` package export warnings appeared, matching prior probes.
- `npm run copy:evaluate`: passed; 30 valid, 0 invalid.
- `npm run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `git diff --check`: passed; Git warned that touched TypeScript/Markdown working-copy line endings will normalize from LF to CRLF when Git writes them.

## Unresolved risks

- PR2 is still flag-gated and not enabled by default.
- No database persistence, server-side publish enforcement, composite QA, screenshot QA, or telemetry emission was added in this slice; those remain later composed-card work.
- Real iPhone screenshots/testing remain out of scope on this Windows machine.

## Rollback

Set the PR2 rollout flags false/unset:

- `AI_V4_PRESENTATION_RESOLVER_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED=false`
- `AI_V4_MINIMAL_INPUT_FLOW_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED=false`
- `AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED=false`

No migration rollback is required.

---

## Composed Ad Card PR 3 - Deterministic QA and exact approval enforcement

Status: Implemented locally on branch `codex/composed-ad-card-pr3`.

Safety checkpoint: `a270b08f` (Composed Ad Card PR 2 commit).

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `lib/ad-composite-qa.ts`
- `lib/ad-composite-qa.test.ts`
- `lib/composed-ad-card-parity-source.test.ts`

## Files changed

- `app/create/ai.tsx`
- `lib/offer-version-publish.ts`
- `lib/offer-version-publish.test.ts`
- `lib/offer-version-publish-source.test.ts`
- `lib/runtime-env.ts`
- `lib/runtime-env.test.ts`
- `supabase/functions/publish-offer-version/index.ts`
- `supabase/functions/_shared/publish-offer-version-function.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added deterministic composite QA for composed-card presentations. It validates the presentation contract, required locked offer and copy fields, image/presentation binding, safe-zone confidence, live-template eligibility, and text-fit repair signals.
- Added default-off rollout flags for composite QA, screenshot-QA gating, and exact presentation approval: `AI_V4_COMPOSITE_QA_ENABLED`, `AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED`, and `AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED`, with matching `EXPO_PUBLIC_` aliases for the client.
- Bound merchant approval to the exact composed presentation hash for new AI-created deals when exact approval is enabled. Style switches, image restoration, regenerate/revise paths, recovered drafts, fallback template creation, and manual draft copy edits clear the approval.
- Extended versioned publish `ad_spec` payloads with composed-card approval metadata: exact presentation, presentation hash, selected template, alternates, merchant style override flag, deterministic QA result, and screenshot-QA decision placeholder.
- Added Edge Function validation for composed-card publish metadata. With exact approval required, missing composed-card approval is rejected. Blocked/unavailable composite QA is rejected. If screenshot QA is enabled and required, publish is rejected unless screenshot QA has passed.
- Added publish analytics context fields for composed-card approval hash, selected template, alternate count, style override, composite QA decision/repair count, and screenshot-QA status.
- Added source guards that feed, detail, and preview remain on the shared `ComposedAdCard` renderer path behind the existing shared-renderer flag.

## Composite QA behavior

- `pass`: presentation is complete and deterministic checks found no repair or block condition.
- `repair`: the card can still be approved, but deterministic repair signals are recorded, such as text fit pressure, low safe-zone confidence, or live-template fallback needs.
- `block`: the preview is missing required offer/copy/image inputs, has an invalid presentation, mismatches the selected image asset, or has another unsafe hard-fail reason.
- Screenshot QA is represented as a bounded publish contract and deterministic trigger. This slice does not implement a model/browser screenshot runner; when the screenshot-QA flag is enabled and a trigger is present, publish is intentionally blocked until a future runner records `pass`.

## Approval and publish enforcement

- Existing behavior is preserved with all PR3 flags off.
- With exact approval enabled, new AI deal publish requires the current composed preview to match the last approved presentation hash.
- Dynamic countdown and quantity state remain outside the approval hash, matching PR1 hash rules.
- Server-side enforcement lives in `publish-offer-version`; hosted enforcement requires an Edge Function redeploy, which was not performed here.

## Validation

- `npx tsc --noEmit --pretty false`: passed.
- `npx vitest run lib/ad-composite-qa.test.ts lib/offer-version-publish.test.ts lib/runtime-env.test.ts lib/offer-version-publish-source.test.ts lib/composed-ad-card-parity-source.test.ts supabase/functions/_shared/publish-offer-version-function.test.ts`: passed; 6 files, 21 tests.
- `npm run test`: passed; 149 files, 814 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed; 30 valid, 0 invalid.
- `npm run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-composed-pr3" --clear`: passed. Existing `country-flag-icons` package export warnings appeared, matching prior probes.
- `git diff --check`: passed; Git warned that touched files will normalize working-copy line endings from LF to CRLF when Git writes them.

## Unresolved risks

- PR3 is still flag-gated and not enabled by default.
- Screenshot QA is only a deterministic trigger and publish contract in this slice; no visual/model screenshot runner was added.
- Customer feed/detail still derive composed presentation from the deal row behind the shared-renderer flag. Loading persisted `offer_versions.ad_spec` for customer surfaces remains future work after the Supabase-side rollout.
- Hosted publish enforcement requires redeploying `publish-offer-version`; deployment is hard-gated and was not performed.
- No real iPhone screenshots/testing were captured on this Windows machine.

## Rollback

Set the PR3 rollout flags false/unset:

- `AI_V4_COMPOSITE_QA_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED=false`
- `AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED=false`
- `AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED=false`
- `EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED=false`

No migration rollback is required.

---

## Composed Ad Card PR 3b - Rollout telemetry and legacy fallback guardrails

Status: Implemented locally on branch `codex/composed-ad-card-pr3b-legacy-cleanup`.

Safety checkpoint: `9262a4a2` (Composed Ad Card PR 3 commit).

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `lib/composed-ad-card-telemetry-source.test.ts`

## Files changed

- `app/create/ai.tsx`
- `lib/analytics.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added stable composed-card rollout analytics event names for preview shown, style changed, approval success, approval block, and publish block.
- Added a render-only `ComposedPreviewTelemetryBeacon` so composed preview telemetry is emitted from the same branch that renders `ComposedAdCard`, without violating parent hook order or touching auth/business/loading fallbacks.
- Recorded internal rollout dimensions requested by the composed-card plan: selected template, alternate count, resolution reason codes, image source type, safe-zone confidence, supporting-copy removal, renderer/spec version, presentation hash, composite QA decision and repair count, screenshot-QA requirement, time to first preview, and time to approval.
- Added style-switch telemetry with previous and next template IDs and hashes. Style switching still clears approval and still makes no model call.
- Added publish/approval block telemetry for exact-approval mismatch, blocked composite QA, and screenshot-QA-required states.
- Preserved the disabled-flag legacy preview fallback for rollback. No feature flag defaults changed.

## Validation

- `npx tsc --noEmit --pretty false`: passed.
- `npx vitest run lib/composed-ad-card-telemetry-source.test.ts lib/composed-ad-card-parity-source.test.ts lib/offer-version-publish-source.test.ts`: passed; 3 files, 6 tests.
- `npm run test`: passed; 150 files, 816 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed; 30 valid, 0 invalid.
- `npm run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-composed-pr3b" --clear`: passed. Existing `country-flag-icons` package export warnings appeared, matching prior probes.
- `git diff --check`: passed; Git warned that touched files will normalize working-copy line endings from LF to CRLF when Git writes them.

## Unresolved risks

- Telemetry only reaches the currently configured lightweight analytics sink. Hosted metric dashboards still depend on a real sink or ingestion path being active.
- The legacy generated preview component remains available when composed-card flags are disabled so rollback stays simple.
- Real-device screenshots and external cohort metric review were not performed in this local Windows pass.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4y - PR4 expansion, cleanup, and calibration closeout

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `873b5e03` (last prior reported PR4 commit).

Commits covered:

- `9c9cd71c` Sanitize AI catch-path telemetry
- `74485148` Sanitize AI router outer errors
- `34a9b512` Sanitize AI helper exception logs
- `7b3f5c1c` Store authoritative deal display copy
- `e1bcefe6` Expand AI category playbooks
- `ea84f87f` Remove legacy compose prompt language
- `6109bdf9` Retire obsolete AI rollout flags
- `8732de53` Add AI baseline calibration watchlist

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `app/create/ai.tsx`
- `app/create/quick.tsx`
- `lib/offer-version-publish.ts`
- `lib/offer-version-publish.test.ts`
- `lib/category-ad-playbooks.ts`
- `lib/category-ad-playbooks.test.ts`
- `lib/runtime-env.ts`
- `lib/runtime-env.test.ts`
- `lib/ai-ad-baseline-runner-source.test.ts`
- `scripts/measure-ai-ad-baseline.mjs`
- `README.md`
- `docs/MIGRATIONS_AND_DEPLOY.md`
- `docs/ai-ad-baseline-metrics.md`
- `docs/ai-ad-current-state.md`
- `docs/ai-ad-validation/SCORECARD.md`
- `docs/deployment-notes.md`
- `docs/edge-function-checklist.md`
- `docs/production-deploy-checklist.md`
- `docs/twofer-ai-ad-mvp.md`
- `supabase/functions/ai-business-lookup/index.ts`
- `supabase/functions/ai-compose-offer/index.ts`
- `supabase/functions/ai-deal-suggestions/index.ts`
- `supabase/functions/ai-extract-menu/index.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/ai-generate-deal-copy/index.ts`
- `supabase/functions/ai-translate-deal/index.ts`
- `supabase/functions/_shared/ai-business-lookup-source.test.ts`
- `supabase/functions/_shared/ai-compose-offer-source.test.ts`
- `supabase/functions/_shared/ai-costs.ts`
- `supabase/functions/_shared/ai-costs.test.ts`
- `supabase/functions/_shared/ai-deal-suggestions-source.test.ts`
- `supabase/functions/_shared/ai-extract-menu-source.test.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`
- `supabase/functions/_shared/ai-generate-deal-copy-source.test.ts`
- `supabase/functions/_shared/ai-image-provider.ts`
- `supabase/functions/_shared/ai-image-provider.test.ts`
- `supabase/functions/_shared/ai-provider-circuit-breaker.ts`
- `supabase/functions/_shared/ai-provider-circuit-breaker.test.ts`
- `supabase/functions/_shared/ai-text-provider.ts`
- `supabase/functions/_shared/ai-text-provider.test.ts`
- `supabase/functions/_shared/ai-translate-deal-source.test.ts`
- `supabase/functions/_shared/dalle-image.ts`
- `supabase/functions/_shared/dalle-image.test.ts`
- `supabase/functions/_shared/gemini-text-provider.ts`
- `supabase/functions/_shared/openai-text-provider.ts`

## What landed

- Sanitized remaining AI helper catch-path, router outer, provider, circuit-breaker, cost-ledger, image-provider, business-lookup, menu-extraction, compose, translation, deal-copy, insights, and ad-variant failure telemetry so raw upstream provider bodies or free-form exception text are not logged or returned.
- Added `buildAuthoritativeDealDisplayCopy()` and used it in Quick Deal and full AI Create publish paths so stored display title/description prefer `OfferDefinitionV1.canonicalOfferLine` and `disclosureLine` with safe fallback.
- Expanded category playbooks from the earlier narrow set into broader local-business taxonomy coverage, including beverage/smoothie, bar, spa, beauty, pet, auto, home, cleaning/laundry, professional service, florist/gift, and events/entertainment categories.
- Removed legacy cafe/craft-specific compose prompt examples and guarded the source against those old canned phrases returning.
- Removed unused Expo-side AI rollout flag helpers and diagnostics entries for obsolete client flags. Active offer-definition and versioned-publish flags remain because publish compatibility still uses them.
- Updated stale docs from `OPENAI_AD_MODEL`/`gpt-4o-mini` wording to the current shared `OPENAI_MODEL` resolver and `gpt-5.5` default.
- Added a calibration watchlist to `scripts/measure-ai-ad-baseline.mjs` for latency, fallback, judge, image-QA, retry, cost, diversity-warning, and image-aesthetic warning metrics.

## Provider routing behavior

Primary structured text provider remains OpenAI through `generateStructuredText()`.

Fallback structured text provider remains Gemini when hosted flags and `GEMINI_API_KEY` enable it.

Routed through the shared text provider locally:

- main ad-variant copy generation/repair;
- `ai-generate-deal-copy`;
- `ai-deal-suggestions`;
- `ai-translate-deal`;
- text/photo `ai-compose-offer`.

Known direct provider paths that remain by design or pending future media routers:

- `ai-compose-offer` voice transcription uses OpenAI Whisper directly;
- `ai-extract-menu` uses a direct OpenAI Responses vision/OCR path, with synthetic output gated to explicit local/preview flag only;
- image generation/edit uses the image-provider abstraction, which is not the structured text router;
- image QA has OpenAI primary plus Gemini fallback for the ad-variant QA path.

## Cost and timeout controls

- Existing structured text timeout controls, fallback timeout controls, cost-budget projection, circuit-breaker support, and per-call cost logging are preserved.
- Baseline dashboard export now shows cost, retry/failure, fallback, judge, image-QA, and calibration watchlist metrics.
- Live numeric calibration was not run from this workspace because service-role access is not available and must not be exposed.

## Feature flags

Preserved active or hosted flags:

- `AI_V3_PROVIDER_ROUTER_ENABLED`
- `AI_TEXT_FALLBACK_ENABLED`
- `AI_TEXT_FALLBACK_PROVIDER`
- `AI_V3_COST_BUDGET_ENABLED`
- `AI_CIRCUIT_BREAKER_ENABLED`
- `AI_V3_INDEPENDENT_JUDGE_ENABLED`
- `AI_VISION_FALLBACK_ENABLED`
- `AI_IMAGE_GEMINI_ENABLED`
- `AI_IMAGE_PROVIDER`
- `AI_IMAGE_OWNER_PHOTO_REFERENCE_ENABLED`
- `EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK`
- `EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH`

Retired unused Expo-side diagnostics/helpers:

- `EXPO_PUBLIC_AI_AD_PIPELINE_V3`
- `EXPO_PUBLIC_BUSINESS_MEDIA_LIBRARY`
- `EXPO_PUBLIC_BUSINESS_SETUP_AUTO_WEBSITE_IMPORT`
- `EXPO_PUBLIC_INSTAGRAM_MEDIA_IMPORT`
- `EXPO_PUBLIC_FACEBOOK_MEDIA_IMPORT`
- `EXPO_PUBLIC_TWOFER_STOCK_LIBRARY`
- `EXPO_PUBLIC_STRICT_AI_COPY_STYLE_GATE`
- `EXPO_PUBLIC_THREE_CREATIVE_CONCEPTS`
- `EXPO_PUBLIC_DETERMINISTIC_AD_TEMPLATES`
- `EXPO_PUBLIC_PENGUIN_DEAL_LOADER`
- `EXPO_PUBLIC_AD_JOB_ASYNC_STATUS`
- `EXPO_PUBLIC_STRICT_NO_PHOTO_GENERATION_INVARIANT`

## Observed latency/cost/fallback metrics

No live metrics were recorded in this workspace. The runner now provides the dashboard and calibration export, but production/staging values require Dan to run it with `SUPABASE_SERVICE_ROLE_KEY` locally and representative non-publishing outputs.

## Acceptance criteria snapshot after PR4 closeout

1. Live primary creative model resolves to `gpt-5.5`: Implemented.
2. Unsupported model names do not silently downgrade: Implemented.
3. Gemini 3.5 Flash is configured as OpenAI availability/credit fallback: Implemented locally, production activation blocked until public privacy/subprocessor update and hosted flags.
4. OpenAI credit/quota failure falls back immediately: Implemented behind hosted fallback flags.
5. Full timeout does not cause a second full OpenAI wait: Implemented.
6. Persistent circuit breaker works across Edge Function instances: Partially implemented; helper and migration exist, but applying the migration is hard-gated.
7. Per-stage provider, model, latency, token, cache, and cost telemetry is stored: Partially implemented; provider/cost telemetry is broad, total end-to-end latency remains a known instrumentation gap.
8. Configurable cost ceilings limit optional calls: Implemented locally behind cost-budget flag.
9. Merchant receives preview or deterministic fallback, never blank state: Implemented for the main ad path.
10. Merchant Creative Profile is available and versioned: Implemented.
11. Unverified merchant claims are excluded from prompts: Implemented.
12. GPT-5.5 returns one positive creative brief and five candidates in one call: Implemented for the main ad path.
13. Five required creative lanes are present: Implemented.
14. Hard duplicate checks are active: Implemented.
15. Similarity heuristics are logged for calibration: Implemented.
16. Gemini judges GPT-5.5 candidates blindly: Implemented behind hosted judge flag.
17. Gemini-generated fallback copy does not receive fake independent judgment: Implemented.
18. Selected candidate is merchant-specific when verified context exists: Implemented.
19. Valid but forgettable candidate can be rejected: Implemented through judge/style/quality controls.
20. Existing style-gate logic is active in production path: Implemented.
21. Customer-facing shorthand is consistently blocked: Implemented.
22. Immutable offer facts remain unchanged: Implemented.
23. Revisions pass the same validation and judgment path: Implemented.
24. Category playbooks are active: Implemented and expanded in PR4 closeout.
25. Deterministic fallback usage and reason are logged: Implemented.
26. Approval remains tied to the exact final version: Implemented for versioned publish path.
27. Merchant can upload images and choose the final source: Implemented.
28. `Use original` performs no generative modification: Implemented.
29. Touch-up, background cleanup, studio polish, and bounded custom edits are available: Partially implemented; preset flows exist, full custom-edit text UI remains limited.
30. Original uploads are immutable and edited results are stored as derivatives: Partially implemented through response/ad-spec metadata; no dedicated lineage table.
31. Merchant can compare original/edited and restore earlier version: Not implemented.
32. Twofer never silently replaces a merchant-selected upload with generated/stock image: Implemented for the controlled ad-variant path.
33. Aesthetic warnings on eligible originals may be overridden: Implemented.
34. Hard safety/auth/technical/misleading blockers cannot be overridden: Implemented.
35. Any image change invalidates prior approval: Implemented for exact approval binding.
36. Publish references exact selected image asset: Implemented in versioned publish/ad spec.
37. Generated images receive QA: Implemented.
38. AI-edited merchant photos receive identity-preservation QA: Implemented in source-aware QA.
39. Original merchant photos receive source-appropriate QA: Implemented.
40. Stock fallbacks receive applicable QA: Partially implemented; approved stock remains distinct, but stock workflows remain limited.
41. Generated and AI-edited images do not pass open when QA is unavailable: Implemented.
42. Moderated unmodified original may use manual acknowledgement during QA outage: Implemented in source-aware warning/override path.
43. OpenAI image QA can fall back to Gemini: Implemented for ad-variant image QA.
44. Crop and overlay safety are checked: Implemented.
45. OpenAI fallback image prompts match stronger Gemini restrictions: Implemented.
46. Deterministic visual fallback is polished and usable: Implemented.
47. Exact offer lines and terms come from structured fields: Implemented; latest publish storage now uses authoritative deal display copy.
48. Consumer feed and detail surfaces share authoritative helpers: Implemented.
49. Legacy canned output cannot appear as live AI: Implemented for known canned AI copy/transcript/insight/compose paths; synthetic menu sample remains explicit preview/dev-only.
50. Google data flow is documented before activation: Implemented internally; public website privacy/subprocessor deployment remains Dan-owned and hard-gated before production fallback activation.
51. No generation or publish path bypasses provider router, offer contract, image-selection record, or approval controls: Partially implemented. Main ad copy, adjacent text helpers, translation, and compose text/photo now use the router; new AI Create and Quick Create publishes now require `publish-offer-version` and an offer definition. Remaining direct media-specific paths are Whisper transcription, menu OCR, and image provider/QA surfaces, and existing-deal edit/update compatibility still writes directly to `deals`.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Implemented.

## Validation

Focused checks passed:

- `npx vitest run lib/offer-version-publish.test.ts lib/deal-localization.test.ts lib/deal-display-copy.test.ts`
- `npx vitest run lib/category-ad-playbooks.test.ts lib/merchant-creative-profile.test.ts supabase/functions/ai-generate-ad-variants/prompt.test.ts`
- `npx vitest run supabase/functions/_shared/ai-compose-offer-source.test.ts`
- `npx vitest run lib/runtime-env.test.ts supabase/functions/_shared/ai-google-data-flow-docs.test.ts`
- `npx vitest run lib/ai-ad-baseline-runner-source.test.ts`
- `node scripts/measure-ai-ad-baseline.mjs --help`
- `npm run gate:ai-ad`

Full checks passed after each closeout slice:

- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npm run copy:evaluate` (30 fixtures valid / 0 invalid)
- `npm run typecheck:functions -- --pretty false` (128 Edge Function files)
- `npm run test -- --run` (latest run: 136 files / 757 tests; expected Expo push negative-path stderr appeared)
- Android Metro export probes succeeded through `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4af"`; known `country-flag-icons` package export warnings and Metro cache fallback appeared, but the bundle exported.

## Unresolved risks

- Hosted production still requires Dan-controlled Edge Function redeploys for local Edge Function changes to take effect.
- Public website privacy/subprocessor update remains required before production can enable Google/Gemini text fallback.
- Live threshold calibration remains blocked until Dan runs representative non-publishing outputs and the service-role baseline dashboard locally.
- The role-split migration and AI limit deploy reminders from the repo spec remain separate hard-gated Supabase work.
- `ai-create-deal` is now permanently disabled in source and no longer contains a re-enableable generation-plus-insert path.
- Voice transcription and menu OCR remain direct media-specific provider calls pending future provider-neutral media routers.

## Rollback

Revert the covered commits. No migration rollback is required for this closeout section.

## PR 4f - Disable legacy compose-offer poster generation

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `67090bbf`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-compose-offer/index.ts`
- `supabase/functions/_shared/ai-compose-offer-source.test.ts`
- `lib/ai-compose-offer.ts`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Disabled the legacy `ai-compose-offer` poster image generation path that used `buildPosterImagePrompt` and could bake offer text into pixels.
- Compose requests that still pass `generate_poster_image=true` now continue returning composed offer copy, with `poster_image_unavailable: true` and `poster_disabled_reason: "native_text_rendering_required"`.
- Removed the compose-offer dependency on legacy poster image generation helpers.
- Expanded the source guard test so this path cannot reintroduce `buildPosterImagePrompt`, poster upload, or `poster_image_generation` cost logging.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved from PR 4a; no canned output added.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for `ai-compose-offer`; the legacy poster path can no longer produce text-baked generated images.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-compose-offer-source.test.ts`: passed, 1 file / 2 tests.
- `deno check supabase/functions/ai-compose-offer/index.ts`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed on rerun, 122 Edge Function files. First 120s attempt timed out before completion.
- `npm run test -- --run`: passed, 129 files / 718 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4f" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-compose-offer` still uses a legacy direct OpenAI chat-completions call for normal compose copy.
- The client wrapper still accepts the deprecated `generate_poster_image` field for compatibility, but the Edge Function ignores it.
- Broader compose-offer routing through the provider router remains pending.

## Rollback

Revert this commit. No migration rollback is required.

## PR 4g - AI quality/cost dashboard metrics export

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `12338018`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `scripts/measure-ai-ad-baseline.mjs`
- `lib/ai-ad-baseline-runner-source.test.ts`
- `docs/ai-ad-baseline-metrics.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Extended the read-only AI ad baseline runner into a local dashboard-style metrics export without requiring new live telemetry fields.
- Added provider fallback rate/reasons, provider attempt breakdowns, candidate judge usage/skips/latency, image QA decisions, image source/edit mode counts, and merchant image-warning override acknowledgement metrics.
- Expanded the Markdown export so Dan can review operational quality/cost health from one generated artifact after providing service-role access locally.
- Added a source guard test to keep the provider, judge, and image-QA dashboard sections from disappearing in later edits.

## Acceptance criteria map

7. Per-stage provider, model, latency, token, cache, and cost telemetry is stored: Visibility improved by aggregating stored provider attempt and cost ledger rows.
44. Merchant override and image QA outcomes are visible: Improved through image QA decision, warning, hard-fail, unavailable, and override acknowledgement metrics.
51. No generation or publish path bypasses provider/contract/image/approval controls: Visibility improved; this slice does not change runtime controls.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `node --check scripts/measure-ai-ad-baseline.mjs`: passed.
- `node scripts/measure-ai-ad-baseline.mjs --help`: passed.
- `npx vitest run lib/ai-ad-baseline-runner-source.test.ts`: passed, 1 file / 1 test.
- `npm run gate:ai-ad`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 122 Edge Function files.
- `npm run test -- --run`: passed, 130 files / 719 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4g" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- No live Supabase service-role analytics pull was run in this workspace, so production values are still not recorded here.
- The dashboard is a local Markdown/JSON export, not a hosted dashboard or alerting system.
- Publish conversion, no-edit publish rate, and end-to-end generation-to-redemption funnel remain limited until a durable generation/ad id is written through publish, claim, and redemption.

## Rollback

Revert this commit. No migration rollback is required.

## PR 4h - Remove canned AI insights fallback

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `101b6091`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-deal-suggestions/index.ts`
- `supabase/functions/_shared/ai-deal-suggestions-source.test.ts`
- `docs/deployment-notes.md`
- `docs/edge-function-checklist.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed the generated-looking canned suggestion cards from `ai-deal-suggestions` when `OPENAI_API_KEY` is missing.
- Missing provider configuration now returns HTTP 503 with `error_code: "OPENAI_NOT_CONFIGURED"` instead of a successful `{ suggestions }` response.
- Added a source guard so canned insight phrases and `fallbackSuggestions` cannot be reintroduced silently.
- Updated deployment/checklist/current-state docs to call out the fail-closed behavior.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Improved for `ai-deal-suggestions`; missing OpenAI config no longer returns canned insights.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for one adjacent AI insights route; the live provider path is unchanged.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-deal-suggestions-source.test.ts`: passed, 1 file / 1 test.
- `deno check supabase/functions/ai-deal-suggestions/index.ts`: passed.
- Canned phrase scan for `fallbackSuggestions`, `Expand your lineup`, `Weekend pastry pairing`, and `Tell your origin story`: no matches in `ai-deal-suggestions`, docs, components, or lib.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 123 Edge Function files.
- `npm run test -- --run`: passed, 131 files / 720 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4h" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-deal-suggestions` was routed through the shared text provider in PR 4q; broader provider-router migration remains pending for other helper routes.
- This slice changes the missing-key UX from successful suggestions to an error state in `AiInsightsCard`.
- Other adjacent AI routes still need separate audit or routing work.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4i - Fail closed for missing AI translation provider

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `a1e515f4`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-translate-deal/index.ts`
- `supabase/functions/_shared/ai-translate-deal-source.test.ts`
- `docs/deployment-notes.md`
- `docs/edge-function-checklist.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed the missing-`OPENAI_API_KEY` success path that returned deterministic phrase-table translations from `ai-translate-deal`.
- Missing provider configuration now returns HTTP 503 with `error_code: "OPENAI_NOT_CONFIGURED"` and logs a failed unavailable translation with `openai_called=false`.
- The missing-provider path no longer writes deterministic translations back to `deals`.
- Added a source guard so this fail-closed behavior cannot regress silently.
- Updated deployment/checklist/current-state docs to call out the translation provider failure behavior.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Improved for `ai-translate-deal`; missing OpenAI config no longer returns or saves deterministic translations as AI output.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for one adjacent localization route; the live provider path is unchanged.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-translate-deal-source.test.ts`: passed, 1 file / 1 test.
- `deno check supabase/functions/ai-translate-deal/index.ts`: passed.
- Missing-provider source scan: fallback phrase generation and `deals` updates are absent from the `if (!openAiKey)` block.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 124 Edge Function files.
- `npm run test -- --run`: passed, 132 files / 721 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4i" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-translate-deal` was routed through the shared text provider in PR 4r; broader provider-router migration remains pending for other helper routes.
- Direct callers now receive an unavailable error when `OPENAI_API_KEY` is missing. The fire-and-forget `translateDeal` caller already treats translation errors as nonfatal.
- The phrase-table fallback still exists for empty-input skip handling and for filling missing fields in malformed/incomplete AI responses.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4j - Remove canned compose voice transcript fallback

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `76d1fcc9`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-compose-offer/index.ts`
- `supabase/functions/_shared/ai-compose-offer-source.test.ts`
- `docs/deployment-notes.md`
- `docs/edge-function-checklist.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed the `transcribe_only` missing-`OPENAI_API_KEY` success path that returned a canned voice transcript.
- Voice transcription now validates the submitted audio, logs a failed `voice_transcribe` attempt with `openai_called=false`, and returns HTTP 503 with `error_code: "OPENAI_KEY_MISSING"` when Whisper is unavailable.
- Expanded the existing compose-offer source guard so canned transcript text cannot be reintroduced silently.
- Updated deployment/checklist/current-state docs to call out fail-closed compose and voice transcription behavior.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Improved for `ai-compose-offer`; missing OpenAI config no longer returns a canned voice transcript.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for the voice transcription-only path; the live compose and Whisper provider paths are unchanged.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-compose-offer-source.test.ts`: passed, 1 file / 3 tests.
- `deno check supabase/functions/ai-compose-offer/index.ts`: passed.
- Canned transcript scan for `oat milk latte special` and `freshly pulled`: no matches in `ai-compose-offer`.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 124 Edge Function files.
- `npm run test -- --run`: passed, 132 files / 722 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4j" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-compose-offer` still uses direct OpenAI chat-completions and Whisper calls when configured; broader provider-router migration remains pending.
- Voice transcription now surfaces an unavailable error instead of seeding typed prompt text when `OPENAI_API_KEY` is missing.
- The preview/dev-only synthetic menu extraction fallback remains separately gated by `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY=true`.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4k - Remove raw provider error bodies from adjacent text helpers

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `c990560a`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-generate-deal-copy/index.ts`
- `supabase/functions/ai-deal-suggestions/index.ts`
- `supabase/functions/_shared/ai-generate-deal-copy-source.test.ts`
- `supabase/functions/_shared/ai-deal-suggestions-source.test.ts`
- `docs/deployment-notes.md`
- `docs/edge-function-checklist.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed client-facing `details: text` provider bodies from OpenAI HTTP failure responses in `ai-generate-deal-copy` and `ai-deal-suggestions`.
- Preserved server-side diagnostics by continuing to log the raw provider body, truncated, in `ai_generation_costs.error_message`.
- Added `error_code: "AI_GENERATION_FAILED"` and HTTP 502 for those upstream provider failures.
- Added source guards for both helper routes so raw provider bodies cannot be reintroduced silently.
- Updated deployment/checklist/current-state docs to call out the non-raw client behavior.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved from prior PR4 slices; no canned output added.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for adjacent text helper failure handling; raw provider responses no longer reach clients, but the live provider paths are unchanged.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-generate-deal-copy-source.test.ts supabase/functions/_shared/ai-deal-suggestions-source.test.ts`: passed, 2 files / 3 tests.
- `deno check supabase/functions/ai-generate-deal-copy/index.ts`: passed.
- `deno check supabase/functions/ai-deal-suggestions/index.ts`: passed.
- Raw provider detail scan: `details: text` no longer appears in either helper route.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 125 Edge Function files.
- `npm run test -- --run`: passed, 133 files / 724 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4k" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-generate-deal-copy` was routed through the shared text provider in PR 4p, and `ai-deal-suggestions` was routed through it in PR 4q. Broader provider-router migration remains pending for other legacy helper routes.
- The legacy gated `ai-create-deal` route still combines generation and insert if deliberately re-enabled; its raw-provider error response was cleaned up in PR 4l.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4l - Remove raw provider errors from legacy create-deal route

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `d468e06c`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-create-deal/index.ts`
- `supabase/functions/_shared/ai-create-deal-source.test.ts`
- `docs/edge-function-checklist.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed client-facing `details: text` provider bodies from OpenAI HTTP failure responses in the default-closed `ai-create-deal` legacy endpoint.
- Preserved server-side diagnostics by continuing to log the raw provider body, truncated, in `ai_generation_costs.error_message`.
- Added `error_code: "AI_GENERATION_FAILED"` and HTTP 502 for those upstream provider failures.
- Expanded the existing default-closed source guard so raw provider bodies cannot be reintroduced if the endpoint is ever deliberately re-enabled.
- Updated current-state and checklist docs to call out the non-raw client behavior.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved from prior PR4 slices; no canned output added.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for a default-closed legacy route's failure handling; the route remains gated off by default and still should not be a pilot happy path.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-create-deal-source.test.ts`: passed, 1 file / 2 tests.
- `deno check supabase/functions/ai-create-deal/index.ts`: passed.
- Raw provider detail scan: `details: text` no longer appears in `ai-create-deal`.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 125 Edge Function files.
- `npm run test -- --run`: passed, 133 files / 725 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4l" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-create-deal` still combines generation and live insert if deliberately re-enabled with `AI_LEGACY_CREATE_DEAL_ENABLED=true`; it should remain disabled for the pilot.
- The broader provider-router migration for remaining adjacent helper routes remains pending.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4m - Remove raw Whisper transcription errors from compose

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `00997f67`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-compose-offer/index.ts`
- `supabase/functions/_shared/ai-compose-offer-source.test.ts`
- `docs/edge-function-checklist.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed client-facing raw Whisper/provider exception text from `ai-compose-offer` voice transcription failures.
- Preserved server-side diagnostics through the existing `whisper_error` console log and `ai_generation_costs.error_message` entry.
- Added a source guard that keeps voice transcription failures returning a generic `TRANSCRIPTION_FAILED` response.
- Updated current-state and checklist docs to call out non-raw transcription failure behavior.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved from prior PR4 slices; no canned output added.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for `ai-compose-offer` voice failure handling; the configured Whisper path still remains a direct provider call pending broader provider-router work.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-compose-offer-source.test.ts`: passed, 1 file / 4 tests.
- `deno check supabase/functions/ai-compose-offer/index.ts`: passed.
- Voice transcription response scan: the failure response returns `Voice transcription failed.` / `TRANSCRIPTION_FAILED` and no longer returns `e.message`.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 125 Edge Function files.
- `npm run test -- --run`: passed, 133 files / 726 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4m" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-compose-offer` still uses direct OpenAI chat-completions and Whisper calls when configured; broader provider-router migration remains pending.
- Raw provider bodies are still intentionally stored in server-side cost diagnostics for operator debugging.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4n - Add Gemini fallback for image QA

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `dccc9efd`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`

## Files changed

- `supabase/functions/ai-generate-ad-variants/index.ts`
- `docs/edge-function-checklist.md`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added a Gemini multimodal fallback for `ai-generate-ad-variants` image QA when OpenAI vision QA is unavailable.
- Kept the fallback hosted-flag gated through `AI_VISION_FALLBACK_ENABLED=true` and `AI_VISION_FALLBACK_PROVIDER=gemini`.
- Reused the existing image QA prompt and canonical `QUICK_DEAL_IMAGE_QA_SCHEMA` for the Gemini fallback request.
- Logged Gemini image QA attempts privately in `ai_generation_costs` with `provider: "gemini"` and controlled error messages.
- Preserved existing fail-closed behavior: if OpenAI and Gemini QA are both unavailable, generated/AI-edited/stock paths still reject, fall back, or return safe copy-only/original behavior rather than passing unchecked imagery.
- Added a source guard for fallback flagging, schema reuse, image-byte inclusion, private telemetry, and OpenAI-to-Gemini fallback calls.

## Acceptance criteria map

35. Generated/AI-edited fail closed on hard QA failures: Preserved.
36. Generated/AI-edited fail closed on QA outage: Preserved when both QA providers are unavailable.
37. Required visual items checked for generated/edited images: Preserved with a second QA provider available behind flag.
38. Forbidden visual elements checked: Preserved through the shared image QA prompt/schema.
43. Gemini vision QA fallback: Implemented locally for the ad-variant image QA path.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for image QA resilience without pass-open behavior.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx vitest run supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`: passed, 1 file / 3 tests.
- `deno check supabase/functions/ai-generate-ad-variants/index.ts`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 126 Edge Function files.
- `npm run test -- --run`: passed, 134 files / 729 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4n" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- No live provider call was made from this workspace; hosted behavior still depends on deployed function code, `GEMINI_API_KEY`, and `AI_VISION_FALLBACK_ENABLED=true`.
- Image QA fallback is implemented in the ad-variant function path, not yet extracted into a shared vision-provider abstraction for other future vision features.

## Rollback

Revert this commit, or leave `AI_VISION_FALLBACK_ENABLED=false` in hosted configuration. No migration rollback is required.

---

## PR 4o - Correct current-state model resolver docs

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `a5cf36f7`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Corrected the current-state audit's model resolver note to match code: `gpt-5.5` is allowlisted and is now the default production text model.
- Documented that unsupported configured OpenAI models throw `AI_TEXT_CONFIG_INVALID` instead of silently downgrading.

## Acceptance criteria map

1. Live primary creative model resolves to `gpt-5.5`: Documentation now matches the implemented resolver behavior.
2. Unsupported model configuration fails closed: Documentation now matches the implemented resolver behavior.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 126 Edge Function files.
- `npm run test -- --run`: passed, 134 files / 729 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4o" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- Hosted production still requires Dan-controlled deployment/configuration verification; no live secret or deployed Edge Function state was queried from this workspace.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4p - Route deal-copy helper through shared text provider

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `119f7a69`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-generate-deal-copy/index.ts`
- `supabase/functions/_shared/ai-generate-deal-copy-source.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Replaced the helper's direct OpenAI chat-completions call with the shared structured text provider router.
- Preserved the existing fail-closed `OPENAI_NOT_CONFIGURED` behavior when `OPENAI_API_KEY` is missing and no configured Gemini route can continue.
- Allowed the helper to use Gemini text generation only when the provider router is enabled and `GEMINI_API_KEY` is configured.
- Logged provider attempts through `ai_generation_costs` with provider/model/cost metadata and sanitized error classes.
- Kept client-facing upstream generation failures generic with `error_code: "AI_GENERATION_FAILED"`.
- Added source guards so this helper does not regain a direct OpenAI fetch or raw provider error details.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved; no canned output path added.
51. No generation path bypasses provider/quality controls: Improved for `ai-generate-deal-copy`; it now shares the provider router and sanitized attempt telemetry used by the main ad-copy path.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/ai-generate-deal-copy/index.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-generate-deal-copy-source.test.ts`: passed, 1 file / 2 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 126 Edge Function files.
- `npm run test -- --run`: passed, 134 files / 730 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4p" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-compose-offer` still uses direct OpenAI chat-completions and Whisper calls when configured; broader provider-router migration remains pending.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

## PR 4q - Route AI insights helper through shared text provider

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `7bd64838`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-deal-suggestions/index.ts`
- `supabase/functions/_shared/ai-deal-suggestions-source.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Replaced the AI insights helper's direct OpenAI chat-completions call with the shared structured text provider router.
- Preserved the existing fail-closed `OPENAI_NOT_CONFIGURED` behavior when `OPENAI_API_KEY` is missing and no configured Gemini route can continue.
- Allowed AI insights to use Gemini text generation only when the provider router is enabled and `GEMINI_API_KEY` is configured.
- Logged provider attempts through `ai_generation_costs` with provider/model/cost metadata and sanitized error classes.
- Kept client-facing upstream generation failures generic with `error_code: "AI_GENERATION_FAILED"`.
- Added source guards so canned insight cards, direct OpenAI fetches, and raw provider details are not reintroduced silently.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved; no canned insight fallback path added.
51. No generation path bypasses provider/quality controls: Improved for `ai-deal-suggestions`; it now shares the provider router and sanitized attempt telemetry used by the main ad-copy path.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/ai-deal-suggestions/index.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-deal-suggestions-source.test.ts`: passed, 1 file / 3 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 126 Edge Function files.
- `npm run test -- --run`: passed, 134 files / 731 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4q" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-compose-offer` still uses direct OpenAI chat-completions and Whisper calls when configured; broader provider-router migration remains pending.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4r - Route translation helper through shared text provider

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `a95ece2a`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-translate-deal/index.ts`
- `supabase/functions/_shared/ai-translate-deal-source.test.ts`
- `supabase/functions/_shared/ai-text-provider.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Replaced the translation helper's direct OpenAI chat-completions call with the shared structured text provider router.
- Added a provider operation label for translation telemetry.
- Preserved the existing fail-closed `OPENAI_NOT_CONFIGURED` behavior when `OPENAI_API_KEY` is missing and no configured Gemini route can continue.
- Allowed translations to use Gemini text generation only when the provider router is enabled and `GEMINI_API_KEY` is configured.
- Logged provider attempts through `ai_generation_costs` with provider/model/cost metadata and sanitized error classes.
- Kept client-facing upstream generation failures generic with `error_code: "AI_GENERATION_FAILED"`.
- Kept the existing owner check, monthly limit, empty-text skip, direct-mode response shape, and save behavior.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved; missing provider configuration still cannot return or save deterministic phrase-table translations as AI output.
51. No generation path bypasses provider/quality controls: Improved for `ai-translate-deal`; it now shares the provider router and sanitized attempt telemetry used by the main ad-copy path.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/ai-translate-deal/index.ts`: passed.
- `deno check supabase/functions/_shared/ai-text-provider.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-translate-deal-source.test.ts`: passed, 1 file / 3 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 126 Edge Function files.
- `npm run test -- --run`: passed, 134 files / 733 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4r" --clear`: passed. The existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-compose-offer` still uses direct OpenAI chat-completions and Whisper calls when configured; broader provider-router migration remains pending.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4c - Google/Gemini data-flow activation gate

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `08136d4f`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `docs/ai-google-data-flow.md`
- `supabase/functions/_shared/ai-google-data-flow-docs.test.ts`

## Files changed

- `docs/ai-ad-current-state.md`
- `scripts/check-ai-ad-release-gates.mjs`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Documented the Google/Gemini AI data flow for text fallback, independent candidate judging, image generation, and merchant-photo image edit paths.
- Documented that Google/Gemini text fallback must stay disabled with `AI_TEXT_FALLBACK_ENABLED=false` until Dan approves and deploys the public privacy/subprocessor update.
- Documented sensitive data exclusions: customer personal data, QR tokens, claim codes, redemption codes, push tokens, provider keys, Supabase secrets, signing material, and voice audio recordings are not sent to Google/Gemini for this feature.
- Added exact public privacy/subprocessor copy Dan can use in the website repo.
- Added `npm run gate:ai-ad` coverage for the Google/Gemini data-flow doc.
- Added a source guard test that checks the doc and verifies Gemini text fallback remains closed by default in `ai-text-provider.ts`.

## Tests added and results

Focused validation:

- `npx vitest run supabase/functions/_shared/ai-google-data-flow-docs.test.ts`: passed, 1 file and 2 tests.
- `npm run gate:ai-ad`: passed, including the new Google/Gemini data-flow gate.

Full validation:

- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 121 Edge Function files checked.
- `npm run test -- --run`: passed, 127 files and 714 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 valid fixtures and 0 invalid fixtures.
- Android Metro probe, `npx expo export --platform android --output-dir <temp>`: passed. Existing `country-flag-icons` package export warnings appeared, matching prior probes, but did not fail the bundle.

## Acceptance criteria map

50. Google data flow is documented before activation: Implemented internally with a repo release gate. Public website privacy/subprocessor deployment is still a hard-gated website-repo task for Dan before production can enable `AI_TEXT_FALLBACK_ENABLED=true`.
51. No generation or publish path bypasses provider/contract/image/approval controls: Partially improved through activation gating only; broader legacy route cleanup remains pending.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Unresolved risks

- This slice does not deploy or update the public website privacy/subprocessor page.
- Gemini image routing already exists behind its own image flags; this slice documents the data flow but does not change runtime image behavior.
- Legacy generation route cleanup remains pending for non-ad-variant AI paths.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4d - Legacy one-shot create-deal default gate

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `2625ccbe`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `supabase/functions/_shared/ai-create-deal-source.test.ts`

## Files changed

- `supabase/functions/ai-create-deal/index.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Default-closed the legacy `ai-create-deal` Edge Function behind hosted `AI_LEGACY_CREATE_DEAL_ENABLED=true`.
- The disabled path returns `410` with `error_code: "AI_CREATE_DEAL_LEGACY_DISABLED"` before reading Supabase/OpenAI secrets, generating copy, inserting `deals`, or sending push notifications.
- Added a source guard test to keep the gate ahead of provider and live insert work.
- Updated current-state docs to mark the one-shot AI plus live insert path as default-closed.

## Tests added and results

Focused validation:

- `npx vitest run supabase/functions/_shared/ai-create-deal-source.test.ts`: passed, 1 file and 1 test.
- `deno check supabase/functions/ai-create-deal/index.ts`: passed.

Full validation:

- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 122 Edge Function files checked.
- `npm run test -- --run`: passed, 128 files and 715 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 valid fixtures and 0 invalid fixtures.
- Android Metro probe, `npx expo export --platform android --output-dir <temp>`: passed. Existing `country-flag-icons` package export warnings appeared, matching prior probes, but did not fail the bundle.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved from PR 4a; no canned output added.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for `ai-create-deal`; the legacy one-shot generation plus live insert route is now default-closed unless deliberately re-enabled. Other legacy AI helper routes remain pending.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Unresolved risks

- This does not remove the client wrapper in `lib/functions.ts`; it is unused by current app code and will now receive a controlled disabled response unless the hosted flag is set.
- If Dan deliberately re-enables `AI_LEGACY_CREATE_DEAL_ENABLED=true`, the old one-shot path still calls OpenAI directly and inserts a live deal row.
- Main AI/Quick client publish still includes direct `deals` insert fallbacks when the versioned publish RPC is unavailable; that is a separate, riskier cleanup.

## Rollback

Set hosted `AI_LEGACY_CREATE_DEAL_ENABLED=true` to temporarily restore the legacy endpoint after deployment, or revert this commit. No migration rollback is required.

---

## PR 4e - Versioned publish fail-closed client guard

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `740b1f36`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `lib/offer-version-publish-source.test.ts`

## Files changed

- `app/create/ai.tsx`
- `app/create/quick.tsx`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Full AI Create now fails closed when `EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH=true` but no offer definition is available for a new deal publish.
- Quick Create now fails closed under the same condition instead of falling through to direct `deals` insert.
- Direct insert compatibility remains available only when versioned publish is explicitly disabled, and existing deal edit/update compatibility is unchanged.
- Added source guard coverage to keep the versioned-publish branch from silently bypassing the offer definition.

## Tests added and results

Focused validation:

- `npx vitest run lib/offer-version-publish-source.test.ts`: passed, 1 file and 2 tests.
- `npx tsc --noEmit --pretty false`: passed.

Full validation:

- `npm run typecheck:functions -- --pretty false`: passed, 122 Edge Function files checked.
- `npm run test -- --run`: passed, 129 files and 717 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 valid fixtures and 0 invalid fixtures.
- Android Metro probe, `npx expo export --platform android --output-dir <temp>`: passed. Existing `country-flag-icons` package export warnings appeared, matching prior probes, but did not fail the bundle.

## Acceptance criteria map

47. Exact offer lines and terms come from structured fields: Preserved from PR 4b.
48. Consumer feed and detail surfaces share authoritative helpers: Preserved from PR 4b.
51. No generation or publish path bypasses provider/contract/image/approval controls: Improved for flagged AI Create and Quick publish builds; missing offer definitions no longer silently direct-insert new deals when versioned publish is enabled.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Unresolved risks

- Direct `deals` insert compatibility still exists for builds where `EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH=false`.
- Existing-deal edit/update still writes directly to `deals`; versioned edit semantics remain a future data-model task.
- The versioned publish Edge Function and RPC still need Supabase-side deployment/migration state to be verified by Dan before production activation.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4s - Sanitize compose provider failure telemetry

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `802a9f80`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-compose-offer/index.ts`
- `supabase/functions/_shared/ai-compose-offer-source.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Stopped reading raw Whisper provider response bodies on failed transcription requests.
- Replaced Whisper failure telemetry with a generic `TRANSCRIPTION_FAILED` error message instead of logging the caught provider exception text.
- Replaced live compose OpenAI HTTP failure cost telemetry with sanitized HTTP status details instead of raw provider response text.
- Added compose source guards to keep raw Whisper/live compose provider bodies and exception text out of telemetry paths.
- Updated AI current-state and Edge Function checklist docs to reflect sanitized compose provider failure handling.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved; no canned output added.
51. No generation path bypasses provider/quality controls: Improved for `ai-compose-offer` failure handling; the live compose generation and Whisper transcription calls remain direct provider calls pending broader router/media-input work.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/ai-compose-offer/index.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-compose-offer-source.test.ts`: passed, 1 file / 5 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 126 Edge Function files.
- `npm run test -- --run`: passed, 134 files / 734 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4s" --clear`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-compose-offer` still uses direct OpenAI chat-completions for live offer composition because the shared text provider accepts `imageInputs` in its type but the OpenAI/Gemini adapters do not yet send those image parts.
- `ai-compose-offer` still uses direct Whisper transcription because the current shared provider router is structured text-only.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4t - Route compose offer through shared text provider

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `5e0e6893`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-compose-offer/index.ts`
- `supabase/functions/_shared/ai-compose-offer-source.test.ts`
- `supabase/functions/_shared/ai-text-provider.ts`
- `supabase/functions/_shared/ai-text-provider.test.ts`
- `supabase/functions/_shared/openai-text-provider.ts`
- `supabase/functions/_shared/gemini-text-provider.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added `imageInputs` serialization to the OpenAI and Gemini structured text adapters.
- Added focused adapter tests proving OpenAI receives data-URL image content parts and Gemini receives inline-data image parts.
- Added a `compose_offer` text-provider operation label.
- Routed live `ai-compose-offer` text/photo offer composition through `generateStructuredText`.
- Preserved the existing compose response shape, duplicate cache behavior, cooldown, monthly quota cap, poster-disabled behavior, and semantic validation requiring exactly two variants plus a recommended offer.
- Kept the old fail-closed `OPENAI_KEY_MISSING` behavior unless the shared router is enabled and a Gemini route is configured.
- Logged compose provider attempts through `ai_generation_costs` with provider/model/endpoint metadata and sanitized error classes.
- Kept compose quota counting intact by treating successful routed provider attempts as billable AI calls in `ai_generation_logs.openai_called`.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved; no canned output added.
51. No generation path bypasses provider/quality controls: Improved for live text/photo `ai-compose-offer`; normal compose generation now shares the provider router and multimodal adapter path. Voice transcription remains a direct Whisper call because the shared router is structured text-only.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/ai-compose-offer/index.ts`: passed.
- `deno check supabase/functions/_shared/openai-text-provider.ts supabase/functions/_shared/gemini-text-provider.ts supabase/functions/_shared/ai-text-provider.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-text-provider.test.ts supabase/functions/_shared/ai-compose-offer-source.test.ts`: passed, 2 files / 12 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 126 Edge Function files.
- `npm run test -- --run`: passed, 134 files / 737 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4t" --clear`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- The voice transcription-only path still uses direct Whisper/OpenAI because no provider-neutral audio transcription router exists.
- Gemini text fallback remains hosted-flag gated and must not be enabled in production until Dan completes the public privacy/subprocessor update and deploys the updated Edge Functions.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4u - Sanitize menu extraction provider failures

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `44ea0fcf`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files added

- `supabase/functions/_shared/ai-extract-menu-source.test.ts`

## Files changed

- `supabase/functions/ai-extract-menu/index.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed raw OpenAI response-body reads from `ai-extract-menu` provider HTTP failures.
- Kept provider diagnostics as sanitized status/error code telemetry in `ai_generation_costs`.
- Added source guards proving synthetic sample menu output stays behind `AI_EXTRACT_MENU_ALLOW_SAMPLE_WITHOUT_KEY=true`.
- Added source guards proving the production missing-key path returns `OPENAI_NOT_CONFIGURED` instead of sample output.
- Documented the sanitized menu extraction failure behavior and the production-only deploy requirement.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Improved; synthetic sample menu output remains gated behind the explicit local preview flag.
51. No generation path bypasses provider/quality controls: Improved for menu extraction failure telemetry and fallback gating. `ai-extract-menu` still uses a direct OpenAI Responses vision path because no provider-neutral menu extraction router exists yet.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/ai-extract-menu/index.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-extract-menu-source.test.ts`: passed, 1 file / 2 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npm run typecheck:functions -- --pretty false`: passed, 127 Edge Function files.
- `npm run test -- --run`: passed, 135 files / 739 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4u" --clear`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-extract-menu` still uses a direct OpenAI Responses vision path because the shared structured text router is not a menu OCR/vision extraction router.
- The synthetic sample menu flag must remain disabled in hosted production.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4v - Sanitize image provider failure telemetry

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `e06c4381`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/_shared/dalle-image.ts`
- `supabase/functions/_shared/dalle-image.test.ts`
- `supabase/functions/_shared/ai-image-provider.ts`
- `supabase/functions/_shared/ai-image-provider.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed raw OpenAI image generation/edit response-body reads from failure telemetry paths.
- Replaced OpenAI image failure console logs and cost-attempt messages with status-derived error codes and generic messages.
- Replaced Gemini image generation HTTP failure attempt messages with sanitized status/error-code messages instead of upstream response text.
- Added source guards covering OpenAI and Gemini image provider failure telemetry so raw provider response bodies are not logged or stored in `ai_generation_costs`.
- Documented the image-provider telemetry behavior in the AI current-state, Edge Function checklist, and deployment notes.

## Acceptance criteria map

37. Generated images receive QA: Preserved.
38. AI-edited merchant photos receive identity-preservation QA: Preserved.
41. Generated and AI-edited images do not pass open when QA is unavailable: Preserved.
45. OpenAI fallback image prompts match stronger restrictions: Preserved.
51. No generation path bypasses provider/quality controls: Improved for image generation/edit observability; failure telemetry no longer stores raw upstream provider bodies while preserving provider, model, endpoint, status-derived code, request id, and fallback behavior.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/_shared/dalle-image.ts supabase/functions/_shared/ai-image-provider.ts`: passed.
- `npx vitest run supabase/functions/_shared/dalle-image.test.ts supabase/functions/_shared/ai-image-provider.test.ts`: passed, 2 files / 10 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 127 Edge Function files. A first parallel run left a stale checker process and timed out; rerunning the full check by itself passed.
- `npm run test -- --run`: passed, 135 files / 741 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4v" --clear`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- OpenAI image fallback and Gemini image generation still use provider-specific image helper modules rather than a single provider-neutral image router abstraction.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4w - Sanitize legacy create-deal telemetry

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `080a4b88`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-create-deal/index.ts`
- `supabase/functions/_shared/ai-create-deal-source.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed raw upstream OpenAI response-body reads from the default-closed legacy `ai-create-deal` HTTP failure path.
- Kept the client-facing failure generic with `error_code: "AI_GENERATION_FAILED"` and HTTP 502.
- Kept private cost telemetry useful with `HTTP_status` error codes and generic failure messages instead of provider response text.
- Expanded the source guard so this route cannot silently reintroduce raw provider bodies in client responses or `ai_generation_costs.error_message`.
- Updated current-state and deployment docs to reflect sanitized legacy-route telemetry.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Preserved; no canned output added.
51. No generation path bypasses provider/quality controls: Improved for the explicitly re-enabled legacy create-deal route; its failure telemetry no longer stores raw provider response bodies. The route remains default-closed and is not a pilot happy path.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/ai-create-deal/index.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-create-deal-source.test.ts`: passed, 1 file / 2 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 127 Edge Function files.
- `npm run test -- --run`: passed, 135 files / 741 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4w" --clear`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- `ai-create-deal` still combines generation and live insert if deliberately re-enabled with `AI_LEGACY_CREATE_DEAL_ENABLED=true`; it should remain disabled for the pilot.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4x - Sanitize shared text provider exceptions

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `6ebf5274`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/_shared/openai-text-provider.ts`
- `supabase/functions/_shared/gemini-text-provider.ts`
- `supabase/functions/_shared/ai-text-provider.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/deployment-notes.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Kept OpenAI/Gemini structured text provider classification based on upstream error code/message.
- Changed thrown provider exception messages to generic provider/code strings so raw upstream provider messages are not retained on `AiProviderError.message`.
- Added behavioral tests proving raw provider messages are not exposed while quota classification and error codes still work.
- Documented the shared text-provider exception behavior.

## Acceptance criteria map

3. Gemini 3.5 Flash is configured as OpenAI availability/credit fallback: Preserved.
4. OpenAI credit/quota failure falls back immediately: Preserved through local provider-message classification.
7. Per-stage provider/model/latency/token/cost telemetry is stored: Preserved; attempts still carry provider, model, error class, error code, and request id.
51. No generation path bypasses provider/quality controls: Improved for routed text helpers; raw upstream provider messages no longer survive on shared provider exceptions.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `deno check supabase/functions/_shared/openai-text-provider.ts supabase/functions/_shared/gemini-text-provider.ts supabase/functions/_shared/ai-text-provider.ts`: passed.
- `npx vitest run supabase/functions/_shared/ai-text-provider.test.ts`: passed, 1 file / 8 tests.
- `npx tsc --noEmit --pretty false`: passed.
- `npm run typecheck:functions -- --pretty false`: passed, 127 Edge Function files.
- `npm run test -- --run`: passed, 135 files / 743 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `npx expo export --platform android --output-dir "$env:TEMP\twofer-metro-probe-codex-ai-pr4x" --clear`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- Provider-specific text adapters still parse upstream error JSON locally so classification can distinguish quota, billing, auth, and model failures; this parsed message is not returned, logged, or attached to provider attempts.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4z - Remove remaining craft-biased AI helper prompts

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `a480e3b8`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-deal-suggestions/index.ts`
- `supabase/functions/ai-generate-deal-copy/index.ts`
- `supabase/functions/ai-translate-deal/index.ts`
- `supabase/functions/_shared/ai-deal-suggestions-source.test.ts`
- `supabase/functions/_shared/ai-generate-deal-copy-source.test.ts`
- `supabase/functions/_shared/ai-translate-deal-source.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Replaced stale cafe/specialty-food-biased deal-copy and insight prompts with neutral, fact-bound local-business guidance.
- Added explicit prompt rules against inventing freshness, ingredient, craft, health, popularity, availability, schedule, or discount claims.
- Removed the old deterministic translation phrase tables that could fabricate craft/freshness claims when provider output omitted a target locale field.
- Changed translation fallback behavior to preserve only the original source-locale text instead of inventing untranslated target-locale copy.
- Added source guards for the deal-copy, insight, and translation helpers so stale phrase-table and craft-biased prompt language cannot be silently reintroduced.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Improved; translation no longer has deterministic promotional phrase tables, and helper prompts no longer carry stale specialty-food examples or claims.
51. No generation path bypasses provider/quality controls: Improved; incomplete provider translation output falls back only to source-locale text rather than fabricated target-locale claims.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run supabase/functions/_shared/ai-translate-deal-source.test.ts supabase/functions/_shared/ai-deal-suggestions-source.test.ts supabase/functions/_shared/ai-generate-deal-copy-source.test.ts`: passed, 3 files / 14 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint`: passed, using the explicit npm CLI path because the sandboxed `npm` shim pointed at a missing Roaming npm install.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 136 files / 760 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4z-20260622-1810`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: attempted, but this shell cannot find `deno`; the harness failed before checking code with `'deno' is not recognized as an internal or external command`.
- Whole-repo stale-phrase scan passed for runtime code; remaining matches are source-test guard assertions only.

## Unresolved risks

- Edge Function typecheck still needs a shell with Deno available to complete this validation gate.
- Hosted production still requires Dan-controlled Edge Function redeployment for this local change to take effect.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4aa - Add image compare and restore controls

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `3ba1a996`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `app/create/ai.tsx`
- `lib/create-ai-image-restore-source.test.ts`
- `lib/i18n/locales/en.json`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added local image-version history to the AI create flow for successful initial generations, image/copy revisions, and fallback-image drafts.
- Added an original-versus-current image comparison panel when an uploaded merchant photo produced a different current ad image.
- Added restore controls for the original photo and earlier generated/revised images before publish.
- Restoring an image updates the `generatedAd` image metadata used by versioned publish, clears prior ad acceptance, resets publish status, and keeps the owner in review mode.
- Added a source guard so the compare/restore UI and approval invalidation cannot be silently removed.

## Acceptance criteria map

27. Merchant can upload images and choose the final source: Improved; the create flow now exposes a restore path back to the uploaded original after AI image generation.
30. Original uploads are immutable and edited results are stored as derivatives: Preserved; no storage mutation or migration was added.
31. Merchant can compare original/edited and restore earlier version: Implemented locally in the AI create flow before publish.
35. Any image change invalidates prior approval: Improved; restoring an image clears `adAccepted` and publish success/error state.
36. Publish references exact selected image asset: Preserved; restore updates the `generatedAd` path and image-selection metadata consumed by versioned publish.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib/create-ai-image-restore-source.test.ts lib/merchant-image-selection.test.ts lib/ad-media-selection.test.ts`: passed, 3 files / 11 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint`: passed, using the explicit npm CLI path because the sandboxed `npm` shim pointed at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 762 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4aa-20260622-1824`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- Image version history is client-side for the active create session and recovered current draft only; there is still no dedicated persisted image-lineage table.
- Hosted production still requires a normal app release path before this local UI change reaches users.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ab - Wire bounded custom image edit controls

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `6f072f9b`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `app/create/ai.tsx`
- `lib/ai-deal-draft-recovery.ts`
- `lib/ai-deal-draft-recovery.test.ts`
- `lib/create-ai-image-restore-source.test.ts`
- `lib/i18n/locales/en.json`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`
- `supabase/functions/_shared/ai-image-provider.ts`
- `supabase/functions/_shared/ai-image-provider.test.ts`
- `supabase/functions/_shared/dalle-image.ts`
- `supabase/functions/_shared/dalle-image.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added a custom photo-edit option beside the existing touch-up, clean-background, and studio-polish controls.
- Added client-side required-text handling for custom edits and persisted the custom instruction in AI draft recovery.
- Required non-empty, policy-valid custom edit text server-side when `image_edit_mode="custom"` is used for a merchant AI edit.
- Passed the sanitized custom edit instruction into both Gemini image prompts and the OpenAI image-edit fallback prompts.
- Kept custom edits bounded to styling, composition, lighting, crop, cleanup, and background changes, while preserving the existing no-text/no-logo/no-QR/no-offer-fact-change guardrails.
- Added source and prompt tests so future changes cannot validate custom text while dropping it before image generation.

## Acceptance criteria map

29. Touch-up, background cleanup, studio polish, and bounded custom edits are available: Implemented locally; custom now has UI, client/server required-text handling, validation, and provider prompt wiring.
30. Original uploads are immutable and edited results are stored as derivatives: Preserved; no storage mutation or migration was added.
32. Twofer never silently replaces merchant-selected uploads: Preserved; custom edits only run when the selected source mode is merchant AI edit.
34. Hard blockers cannot be overridden: Preserved; invalid custom instructions return `IMAGE_EDIT_INSTRUCTION_REJECTED`.
35. Any image change invalidates prior approval: Preserved; changing the custom edit selection/text resets generated state before publish.
38. AI-edited merchant photos receive identity-preservation QA: Preserved; custom edits continue through existing merchant AI edit QA.
45. OpenAI fallback image prompts match stronger Gemini restrictions: Improved; custom instructions are now appended with the same bounded guardrails in both providers.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run supabase/functions/_shared/ai-image-provider.test.ts supabase/functions/_shared/dalle-image.test.ts supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts lib/ai-deal-draft-recovery.test.ts lib/create-ai-image-restore-source.test.ts`: passed, 5 files / 25 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 766 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ab-20260622-1838`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: blocked by local environment because `deno` is not installed or on PATH; all 128 Edge Function files failed for the same missing-command reason.

## Unresolved risks

- This is still a local implementation; the changed Edge Function must be redeployed through the normal hard-gated Supabase deployment path before hosted production uses the new server behavior.
- The custom edit UI is available in English strings in this slice; non-English locale coverage remains a later localization pass.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ac - Localize custom image edit controls

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `2b8fdc9c`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `lib/i18n/locales/es.json`
- `lib/i18n/locales/ko.json`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added Spanish and Korean strings for the custom image-edit option, helper, placeholder, and required-text message.
- Parsed English, Spanish, and Korean locale JSON to confirm the locale files remain valid.

## Acceptance criteria map

29. Touch-up, background cleanup, studio polish, and bounded custom edits are available: Improved; the custom edit UI no longer falls back to English for Spanish and Korean users.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- Locale JSON parse via `node -e`: passed for `en.json`, `es.json`, and `ko.json`.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 766 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ac-20260622-1842`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- This slice only localizes the custom image-edit strings added in PR 4ab; older unrelated create-flow strings remain partially untranslated in Spanish/Korean.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ad - Require original photo warning acknowledgement

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `6c1c87fb`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `app/create/ai.tsx`
- `lib/ai-deal-draft-recovery.ts`
- `lib/ai-deal-draft-recovery.test.ts`
- `lib/create-ai-image-restore-source.test.ts`
- `lib/i18n/locales/en.json`
- `lib/i18n/locales/es.json`
- `lib/i18n/locales/ko.json`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added an explicit checkbox-style acknowledgement when a merchant chooses the original uploaded photo as the final ad image.
- Blocked publish until that acknowledgement is checked for original-photo final images.
- Preserved the acknowledgement in AI draft recovery and reset it when the selected photo/source changes, when restoring the original image, and after edit-save refreshes.
- Changed restored original image versions to start unacknowledged, so restore also requires review before publish.
- Bound the exact publish image-selection QA metadata to the explicit acknowledgement rather than auto-acknowledging original photos.

## Acceptance criteria map

31. Merchant can compare original/edited and restore earlier version: Improved; restoring the original photo now requires explicit acknowledgement before publish.
33. Aesthetic warnings on eligible original uploads may be overridden with explicit acknowledgement: Implemented locally in the AI create flow.
34. Hard blockers cannot be overridden: Preserved; this only acknowledges merchant-original warning/unavailable paths already marked overrideable.
35. Any image change invalidates prior approval: Preserved; source changes and original restore clear acknowledgement and acceptance.
36. Publish references exact selected image asset: Improved; selected-image QA metadata now records the explicit original-photo acknowledgement state.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib/create-ai-image-restore-source.test.ts lib/ai-deal-draft-recovery.test.ts lib/merchant-image-selection.test.ts`: passed, 3 files / 11 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 767 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ad-20260622-1849`: passed. Existing `country-flag-icons` package export warnings still appeared.

## Unresolved risks

- This acknowledgement is implemented in the AI create flow; any older non-versioned compatibility publish path outside this screen should continue to be treated as legacy until it is retired.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ae - Apply QA to approved stock fallback

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `5604d70a`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`
- `lib/quick-deal-image-qa.ts`
- `lib/quick-deal-image-qa.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Changed approved-stock fallback selection from skipped QA to source-aware image QA.
- Ranked approved stock candidates are now checked in order, capped by `AI_STOCK_QA_CANDIDATE_LIMIT` with a default of 3 and maximum of 10.
- Stock assets are fetched through signed storage URLs, inspected as `approved_stock`, and accepted only when source-aware QA does not block.
- If stock bytes cannot be fetched, QA is unavailable, required items are missing, or forbidden elements are found, that stock asset is skipped and the path falls back to the next stock candidate or deterministic copy-only fallback.
- Kept deterministic fallback as the only image source that intentionally skips vision QA.
- Removed the zero-required-items QA short-circuit so generated, AI-edited, and stock visuals can still be checked for forbidden text, logos, QR codes, mascots, and unrelated props even when no required item is inferred.
- Made the shared image-QA prompt source-neutral instead of calling every checked image a generated cafe image.

## Acceptance criteria map

39. Generated images missing required items fail or regenerate: Preserved; generated image QA still blocks and retries.
40. Stock fallbacks receive applicable QA: Implemented locally; approved stock now receives source-aware QA before being accepted.
41. Both QA providers unavailable triggers fallback for generated/edited/stock sources: Improved; approved stock now fails closed on QA outage and falls back to another stock candidate or copy-only.
43. No blank image states are possible: Preserved; if stock cannot pass QA, deterministic copy-only fallback remains available.
45. OpenAI fallback image prompts match stronger Gemini restrictions: Preserved; this slice only changes QA/fallback acceptance.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib/quick-deal-image-qa.test.ts supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`: passed, 2 files / 18 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 771 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ae-20260622-1900`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: blocked by local environment because `deno` is not installed or on PATH; all 128 Edge Function files failed for the same missing-command reason.

## Unresolved risks

- This is still a local implementation; the changed Edge Function must be redeployed through the normal hard-gated Supabase deployment path before hosted production uses the new stock QA behavior.
- Stock QA now inspects up to the configured candidate cap; if all top candidates fail, the system intentionally uses deterministic copy-only fallback instead of passing an unchecked image.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4af - Harden crop and overlay image QA

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `437d6e7f`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `lib/quick-deal-image-qa.ts`
- `lib/quick-deal-image-qa.test.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/_shared/ai-image-provider.ts`
- `supabase/functions/_shared/ai-image-provider.test.ts`
- `supabase/functions/_shared/dalle-image.ts`
- `supabase/functions/_shared/dalle-image.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Expanded the strict image-QA schema with `has_crop_or_overlay_risk` and `crop_or_overlay_issues`.
- Updated the QA prompt to evaluate square mobile-card crop safety, top/bottom native-text overlay zones, center-safe required-item placement, and busy overlay backgrounds.
- Generated, AI-edited, and approved-stock images now hard-fail when crop/overlay risk is reported.
- Unmodified merchant originals treat crop/overlay problems as overrideable warnings, preserving merchant control for quality issues.
- Regeneration feedback now carries crop/overlay issues through the normalized `missing_items` list when a generated image needs repair.
- Added center-safe and native overlay-zone instructions to both Gemini image generation and OpenAI image fallback prompts.
- Updated deterministic raw-QA placeholders to match the expanded schema.

## Acceptance criteria map

35. Generated/AI-edited fail closed on hard QA failures: Improved; crop/overlay risks now become hard QA failures for generated-like sources.
38. Forbidden visual elements checked: Preserved; schema expansion keeps existing forbidden-element checks.
40. Stock fallbacks receive applicable QA: Preserved from PR 4ae; stock now also gets crop/overlay QA.
44. Crop and overlay safety are checked: Implemented locally in the shared image-QA schema/prompt and provider prompts.
45. OpenAI fallback image prompts match stronger Gemini restrictions: Improved; OpenAI fallback now includes center-safe and native overlay-zone requirements.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib/quick-deal-image-qa.test.ts supabase/functions/_shared/ai-image-provider.test.ts supabase/functions/_shared/dalle-image.test.ts supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`: passed, 4 files / 35 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 775 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4af-20260622-1911`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: blocked by local environment because `deno` is not installed or on PATH; all 128 Edge Function files failed for the same missing-command reason.

## Unresolved risks

- This is raw-image safe-zone QA, not a server-side rendered-card screenshot judge. The plan allows raw-image safe-zone QA for the first release; a composite screenshot verifier can still be a later enhancement.
- This is still a local implementation; the changed Edge Function must be redeployed through the normal hard-gated Supabase deployment path before hosted production uses the expanded image-QA schema.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ag - Permanently disable legacy create-deal endpoint

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `fb77a913`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-create-deal/index.ts`
- `supabase/functions/_shared/ai-create-deal-source.test.ts`
- `supabase/functions/_shared/billing-functions-source.test.ts`
- `lib/functions.ts`
- `docs/ai-ad-current-state.md`
- `docs/edge-function-checklist.md`
- `docs/deployment-notes.md`
- `docs/production-deploy-checklist.md`
- `docs/deployment-command-plan.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Replaced the legacy `ai-create-deal` Edge Function with a disabled-only handler that returns HTTP 410 and `AI_CREATE_DEAL_LEGACY_DISABLED`.
- Removed the hosted `AI_LEGACY_CREATE_DEAL_ENABLED` re-enable path from source.
- Removed the old provider call, Supabase client creation, signed-photo path, deterministic copy repair, push, and direct live `deals` insert code from the function.
- Removed the unused `aiCreateDeal()` client wrapper from `lib/functions.ts`.
- Updated source guards so this function cannot regain OpenAI calls, `createClient`, or `.from("deals")` inserts without failing tests.
- Updated billing source guards so the disabled-only legacy route is no longer treated as an active publish-style deal action, while active publish/deal functions still require suspension and verification checks.
- Updated current-state and deployment docs to describe `ai-create-deal` as permanently disabled rather than default-closed.

## Acceptance criteria map

49. Legacy canned output cannot appear as live AI: Improved; this legacy one-shot route cannot generate or publish anything.
51. No generation or publish path bypasses provider router, offer contract, image-selection record, or approval controls: Improved; `ai-create-deal` no longer contains a generation-plus-live-insert bypass.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run supabase/functions/_shared/ai-create-deal-source.test.ts supabase/functions/_shared/billing-functions-source.test.ts lib/quick-deal-ai-policy.test.ts`: passed, 3 files / 15 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 774 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ag-20260622-1928`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: blocked by local environment because `deno` is not installed or on PATH; all 128 Edge Function files failed for the same missing-command reason.

## Unresolved risks

- This is still a local implementation; the changed Edge Function must be redeployed through the normal hard-gated Supabase deployment path before hosted production returns the new disabled-only handler.
- Historical report sections still describe earlier default-closed behavior at the time of those slices; this PR4ag section supersedes them for current state.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ah - Require versioned publish for new create flows

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `3d5609ed`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `app/create/ai.tsx`
- `app/create/quick.tsx`
- `lib/runtime-env.ts`
- `lib/runtime-env.test.ts`
- `lib/offer-version-publish-source.test.ts`
- `eas.json`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed the public `EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH` flag from runtime diagnostics and EAS build env entries.
- Full AI Create now always builds an offer definition for new publishes and always calls `publish-offer-version`; the client-side direct `deals` insert fallback was removed for new AI deals.
- Quick Create now always builds an offer definition and calls `publish-offer-version`; its client-side direct `deals` insert fallback was removed.
- Existing-deal edit/update compatibility in Full AI Create remains unchanged.
- Updated source guards so the flag-disabled direct-insert branch cannot be reintroduced silently.

## Acceptance criteria map

47. Exact offer lines and terms come from structured fields: Preserved; new publishes must carry an offer definition through versioned publish.
51. No generation or publish path bypasses provider router, offer contract, image-selection record, or approval controls: Improved; new AI Create and Quick Create publishes can no longer bypass `publish-offer-version` through a public build flag.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib/offer-version-publish-source.test.ts lib/runtime-env.test.ts lib/offer-version-publish.test.ts`: passed, 3 files / 8 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 773 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ah-20260622-1938`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: blocked by local environment because `deno` is not installed or on PATH; all 128 Edge Function files failed for the same missing-command reason.

## Unresolved risks

- Existing-deal edit/update still writes directly to `deals`; versioned edit semantics remain future data-model work.
- Production still requires Dan-controlled migration and Edge Function deployment verification before the versioned publish path is guaranteed live.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ai - Retire offer-definition fallback rollout flag

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `6d7326ea`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `app/create/quick.tsx`
- `lib/runtime-env.ts`
- `lib/runtime-env.test.ts`
- `eas.json`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Removed the public `EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK` rollout flag from runtime diagnostics and EAS build env entries.
- Quick Create now always builds an offer definition before AI generation.
- Quick Create's deterministic safe draft fallback is always available when `shouldUseQuickDealOfferDefinitionFallback` allows it and an offer definition exists.
- Added a runtime-env guard so the retired flag does not reappear in public diagnostics.

## Acceptance criteria map

9. Merchant receives a preview or polished deterministic fallback, never a blank state: Improved for Quick Create; safe fallback no longer depends on a public build flag.
25. Deterministic fallback usage and reason are logged: Preserved through `quick_deal_offer_definition_fallback_used`.
49. Legacy canned output cannot appear as live AI: Preserved; fallback is deterministic and labeled.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib/runtime-env.test.ts lib/quick-deal-ai-policy.test.ts lib/offer-version-publish-source.test.ts`: passed, 3 files / 6 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 137 files / 772 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ai-20260622-2015`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: blocked by local environment because `deno` is not installed or on PATH; all 128 Edge Function files failed for the same missing-command reason.

## Unresolved risks

- This improves local app fallback behavior only; hosted production still requires the normal app release/deploy process.
- Quick fallback still requires an uploaded/generated photo path when policy demands a safe visual source.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4aj - Polish deterministic fallback preview card

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `66eec2d4`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `components/generated-ad-preview-card.tsx`
- `app/create/ai.tsx`
- `lib/deterministic-ad-fallback-visual.ts`
- `lib/deterministic-ad-fallback-visual.test.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Replaced the plain merchant-preview no-image block in the AI ad preview with a deterministic native fallback visual.
- Added stable business initials and palette selection so fallback previews are intentional and reproducible without creating a fake AI image.
- Added a merchant-facing source label for the fallback visual while keeping headline, offer, CTA, schedule, quantity, and terms rendered as native app text.
- Added unit coverage for fallback initials and deterministic palette selection.

## Acceptance criteria map

9. Merchant receives a preview or polished deterministic fallback, never a blank state: Improved for Full AI Create preview cards.
46. The deterministic visual fallback is polished and usable: Improved locally for merchant preview.
47. Exact offer lines and terms come from structured fields: Preserved; fallback visual does not bake critical deal text into image pixels.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib/deterministic-ad-fallback-visual.test.ts`: passed, 1 file / 3 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint -- --max-warnings=0`: passed, using the explicit npm CLI path because the sandboxed `npm` shim points at a missing Roaming npm install.
- `.\node_modules\.bin\vitest.cmd run --run`: passed, 138 files / 775 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `npm run copy:evaluate`: passed, 30 fixtures valid / 0 invalid.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4aj-20260622-2050`: passed. Existing `country-flag-icons` package export warnings still appeared.
- `npm run typecheck:functions -- --pretty false`: blocked by local environment because `deno` is not installed or on PATH; all 128 Edge Function files failed for the same missing-command reason.

## Unresolved risks

- This is a native-rendered merchant preview improvement, not a server-rendered composite screenshot judge.
- Visual QA still relies on local review plus Metro export here; no local Android emulator screenshot was requested for this slice.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ak - Refresh AI current-state docs

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `259821ed`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Updated the current-state audit to describe new AI Create and Quick Create publishes as versioned `publish-offer-version` flows, with existing-deal edit/update compatibility still called out as direct `deals` updates.
- Updated the prompt/generator version references to `AI_COPY_PROMPT_V4` and `ai-copy-v4`.
- Updated deterministic fallback documentation to reflect the native merchant-preview fallback visual, while preserving the remaining gap for server-side/static-share template rendering.
- Updated operational-gap wording so publish idempotency is credited for new versioned publish requests.

## Acceptance criteria map

46. The deterministic visual fallback is polished and usable: Documentation refreshed to reflect the local merchant-preview implementation.
47. Exact offer lines and terms come from structured fields: Documentation refreshed for versioned publish and AdSpec V1 path.
51. No generation or publish path bypasses provider router, offer contract, image-selection record, or approval controls: Documentation refreshed to distinguish new publishes from existing-deal compatibility updates.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `rg -n "AI_COPY_PROMPT_V2|ai-copy-v2|Three candidate|three candidate|publishes straight to ``deals``|Client publish writes directly|No deterministic template renderer yet|No durable ``AdSpecV1``|No server-side publish transaction|No idempotency key on generation or publish" docs\ai-ad-current-state.md`: no matches.
- `npm run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.

## Unresolved risks

- This is documentation only; it does not deploy migrations, Edge Functions, or website privacy/subprocessor updates.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4al - Route image QA through shared provider router

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `7a946027`.

Deployment actions: Edge Function redeploy required for hosted behavior to change; not performed here.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-vision-qa-source.test.ts`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Replaced the ad-variant function's inline OpenAI Responses and Gemini vision QA HTTP calls with the shared structured provider router using `operation: "image_qa"` and `imageInputs`.
- Preserved OpenAI as the primary image QA provider and kept Gemini fallback behind `AI_VISION_FALLBACK_ENABLED` plus `AI_VISION_FALLBACK_PROVIDER=gemini`.
- Routed image QA provider telemetry through `logTextProviderAttempts`, matching the rest of the shared text-provider paths.
- Updated source guards so future changes keep image QA on the shared router and confirm both shared providers support structured image inputs.
- Refreshed the current-state audit to remove the stale direct `responses` / missing-provider-abstraction wording.

## Acceptance criteria map

51. No generation or publish path bypasses provider router, offer contract, image-selection record, or approval controls: Ad-variant image QA now uses the shared provider router rather than function-local provider calls.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `.\node_modules\.bin\vitest.cmd run supabase\functions\_shared\ai-generate-ad-variants-vision-qa-source.test.ts`: passed; 7 tests.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed; 30 valid, 0 invalid.
- `.\node_modules\.bin\vitest.cmd run`: passed; 138 files, 775 tests.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4al-20260622-2006`: passed with the known `country-flag-icons` package export warnings.
- `npm run typecheck:functions -- --pretty false`: blocked because `deno` is not installed/on PATH; all 128 Edge Function files failed for that same missing-command reason.
- `npm run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.

## Unresolved risks

- Hosted behavior still requires redeploying the changed Edge Function; deployment is a hard gate and was not performed.
- The image QA flow is still synchronous and quality-check results are not persisted as first-class rows.
- Local Deno Edge Function typechecking remains unavailable in this Windows environment until `deno` is installed.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4am - Align AdSpec copy prompt provenance

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `d2cc4ed5`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `lib/ad-spec.ts`
- `lib/ad-spec.test.ts`
- `supabase/functions/ai-generate-ad-variants/prompt.ts`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Updated AdSpec V3 provenance to stamp `AI_COPY_PROMPT_V4`, matching the active ad-copy prompt version.
- Renamed the prompt-body constant from `AI_COPY_PROMPT_V3` to `AI_COPY_PROMPT_V4` so the source no longer carries stale current-version naming.
- Added a drift guard that compares AdSpec provenance against the exported active Edge prompt version.

## Acceptance criteria map

51. No generation or publish path bypasses provider router, offer contract, image-selection record, or approval controls: Improved provenance accuracy for approved AdSpec output.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run lib\ad-spec.test.ts supabase\functions\ai-generate-ad-variants\prompt.test.ts`: passed; 2 files, 16 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `npm run lint`: passed.
- `npm run copy:evaluate`: passed; 30 valid, 0 invalid.
- `.\node_modules\.bin\vitest.cmd run`: passed; 138 files, 776 tests.
- `npm run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4am-20260622-2015`: passed with the known `country-flag-icons` package export warnings.
- `npm run typecheck:functions -- --pretty false`: blocked because `deno` is not installed/on PATH; all 128 Edge Function files failed for that same missing-command reason.

## Unresolved risks

- This aligns code-level provenance only; the formal prompt/model release registry remains a future data-model/deployment task.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4an - Refresh final acceptance map

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `a9e276f7`.

Deployment actions: none.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added a final current acceptance snapshot after the PR4 follow-up series so the report reflects the compare/restore controls, bounded custom edit UI, stock QA, shared image-QA router, AdSpec prompt-provenance fixes, routed non-web research/base64 menu OCR, and total-latency telemetry.
- Kept earlier PR acceptance notes intact as historical checkpoints; this section is the current map as of PR 4ar.
- Marked remaining work as partial or blocked where it requires migrations, hosted Edge Function deploys, public website/privacy deployment, production telemetry, Deno availability, or future data-model work.

## Current acceptance criteria map after PR4ar

1. Implemented - Live primary creative model resolves to `gpt-5.5`.
2. Implemented - Unsupported model names do not silently downgrade.
3. Implemented locally - Gemini 3.5 Flash is configured as OpenAI availability/credit fallback; production activation remains blocked by public privacy/subprocessor deployment and hard-gated hosted flag changes, now documented in the deploy notes.
4. Implemented - OpenAI credit/quota failure falls back immediately behind the routed fallback flags.
5. Implemented - Full timeout does not cause a second full OpenAI wait.
6. Partially implemented - Persistent circuit-breaker helper and migration exist, and deployment docs now call out the flag/migration prerequisite; applying the migration and verifying hosted behavior remain hard-gated.
7. Implemented locally - Provider/model/stage latency/token/cache/cost telemetry exists across routed paths, and the ad-variant generation log payload now records total request latency as `total_latency_ms`; hosted rows need the Edge deploy before this field appears in production data.
8. Implemented locally - Configurable cost ceilings limit optional calls behind the cost-budget flag.
9. Implemented - The merchant receives a preview or deterministic fallback, never a blank state, on the main ad path.
10. Implemented - Merchant Creative Profile is available and versioned at runtime.
11. Implemented - Unverified merchant claims are excluded from prompts.
12. Implemented - GPT-5.5 is asked for one positive creative brief and five candidates in one call on the main ad path.
13. Implemented - The five required creative lanes are present and validated.
14. Implemented - Hard duplicate checks are active.
15. Implemented - Similarity heuristics are logged for calibration.
16. Implemented - Gemini judges GPT-5.5 candidates blindly behind the hosted judge flag.
17. Implemented - Gemini-generated fallback copy does not receive fake same-provider independent judgment.
18. Implemented locally - Selected candidates use verified merchant context when available; live calibration remains a deployment/QA task.
19. Implemented locally - Judge/style/quality controls can reject factually valid but forgettable candidates; live threshold calibration remains a deployment/QA task.
20. Implemented - Existing style-gate logic is active in the production ad-variant path.
21. Implemented - Customer-facing BOGO/2-for-1 shorthand is consistently blocked.
22. Implemented - Immutable offer facts remain unchanged.
23. Implemented - Revisions pass the same validation and judgment path.
24. Implemented - Category playbooks are active and expanded.
25. Implemented - Deterministic fallback usage and reason are logged.
26. Implemented - Approval remains tied to the exact final version for the versioned publish path.
27. Implemented - Merchants can upload images and choose the final source.
28. Implemented - `Use original` performs no generative modification.
29. Implemented locally - Touch-up, background cleanup, studio polish, and bounded custom edits have UI, validation, persistence in draft recovery, and provider prompt wiring.
30. Partially implemented - Original uploads are preserved and edited/generated results carry derivative lineage in response/ad-spec metadata; there is still no dedicated persisted lineage table.
31. Implemented locally - Merchants can compare original/edited images and restore earlier versions before publish in the AI create flow.
32. Implemented - Twofer does not silently replace a merchant-selected upload with a generated or stock image in the controlled ad-variant path.
33. Implemented - Aesthetic warnings on eligible original uploads may be overridden only with explicit acknowledgement.
34. Implemented - Hard safety, authorization, technical, and materially misleading-offer blockers cannot be overridden.
35. Implemented - Any image change invalidates prior approval in the AI create flow.
36. Implemented - Publish references the exact selected image asset in versioned publish/ad spec metadata.
37. Implemented - Generated images receive QA.
38. Implemented - AI-edited merchant photos receive source-aware identity-preservation QA.
39. Implemented - Original merchant photos receive source-appropriate QA.
40. Implemented locally - Approved-stock fallbacks receive applicable QA before acceptance; broader stock-library workflows remain limited.
41. Implemented - Generated and AI-edited images do not pass open when QA is unavailable.
42. Implemented - A previously moderated unmodified merchant original may use the documented manual-acknowledgement path during QA outage.
43. Implemented - OpenAI image QA can fall back to Gemini through the shared provider router for ad-variant image QA.
44. Implemented - Crop and native overlay safety are checked.
45. Implemented - OpenAI fallback image prompts match the stronger Gemini restrictions.
46. Implemented - The deterministic visual fallback is polished and usable.
47. Implemented - Exact offer lines and terms come from structured fields on the current publish/render path.
48. Implemented - Consumer feed and detail surfaces share authoritative display helpers.
49. Implemented - Known canned AI copy/transcript/insight/compose fallbacks cannot appear as live AI; synthetic menu sample output remains explicit preview/dev-only behavior.
50. Partially implemented - Google data flow is documented internally, release-gated, and covered in deployment flag docs; public website privacy/subprocessor deployment remains Dan-owned and hard-gated before production fallback activation.
51. Partially implemented - Main ad copy, non-web ad research, adjacent text helpers, translation, compose text/photo, app-facing base64 menu OCR, and ad-variant image QA use the provider router, and new AI Create/Quick publishes require versioned publish plus offer definitions. Remaining direct paths are live web-search preview, Whisper transcription, legacy menu `image_url` OCR, image generation/edit providers, and existing-deal edit/update compatibility.
52. Implemented - No GPT-5.4-mini versus GPT-5.5 comparison was performed.

## Validation

- `git diff --check`: passed; Git warned that the Markdown working-copy line endings will normalize from LF to CRLF when touched.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run lint`: passed. Plain `npm run lint` is still blocked by this machine's broken Roaming npm shim.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run copy:evaluate`: passed; 30 valid, 0 invalid.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `.\node_modules\.bin\vitest.cmd run`: passed; 138 files, 776 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4an-20260623-2024`: passed with the known `country-flag-icons` package export warnings.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run typecheck:functions -- --pretty false`: blocked because `deno` is not installed/on PATH; all 128 Edge Function files failed for that same missing-command reason.

## Unresolved risks

- Hosted behavior still requires Dan-controlled migrations, Edge Function redeploys, app release paths, public website/privacy deployment, and production/staging non-publishing QA.
- Local Edge Function typechecking remains blocked until `deno` is installed or available on PATH.
- Criteria 6, 30, 50, and 51 are intentionally not marked fully complete because the remaining work crosses a hard gate or requires future persisted data-model work.

## Rollback

Revert this documentation commit. No migration rollback is required.

---

## PR 4ao - Route non-web ad research through provider router

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `305a66e9`.

Deployment actions: Edge Function redeploy required for hosted behavior to change; not performed here.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-research-source.test.ts`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added a strict `ITEM_RESEARCH_SCHEMA` and prompt version for ad-variant item research.
- Routed the non-web item-identification research pass through `generateStructuredText` with `operation: "merchant_context"`, shared provider config, Gemini fallback support, and shared provider-attempt telemetry.
- Kept the explicit `gpt-4o-search-preview` web-search branch direct because the shared provider router does not model live-search tooling yet.
- Added a source guard that prevents the non-web research pass from drifting back to raw OpenAI chat completions while preserving the separately logged web-search branch.
- Updated the current-state audit to distinguish routed non-web research from remaining media/tool-specific direct provider paths.

## Acceptance criteria map

51. No generation path bypasses provider/quality controls: Improved; ad-variant non-web item research now shares the provider router used by other text helper paths. Remaining direct provider paths are live web-search preview, Whisper transcription, menu OCR, image generation/edit providers, and existing-deal edit/update compatibility.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run supabase\functions\_shared\ai-generate-ad-variants-research-source.test.ts`: passed; 1 file, 2 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `git diff --check`: passed; Git warned that touched Markdown/TypeScript working-copy line endings will normalize from LF to CRLF when Git writes them.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run lint`: passed.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run copy:evaluate`: passed; 30 valid, 0 invalid.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `.\node_modules\.bin\vitest.cmd run`: passed; 139 files, 778 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ao-20260623-2031`: passed with the known `country-flag-icons` package export warnings.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run typecheck:functions -- --pretty false`: blocked because `deno` is not installed/on PATH; all 129 Edge Function files failed for that same missing-command reason.

## Unresolved risks

- Hosted behavior still requires redeploying `ai-generate-ad-variants`; deployment is a hard gate and was not performed.
- Live web-search preview remains a direct OpenAI search-preview call until there is a provider-neutral live-search abstraction.
- Local Edge Function typechecking remains blocked until `deno` is installed or available on PATH.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ap - Route base64 menu OCR through provider router

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `a7b997be`.

Deployment actions: Edge Function redeploy required for hosted behavior to change; not performed here.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-extract-menu/index.ts`
- `supabase/functions/_shared/ai-extract-menu-source.test.ts`
- `lib/functions.ts`
- `docs/ai-ad-current-state.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added a strict routed menu-extraction prompt version for app-facing base64 menu scans.
- Routed base64 menu images through `generateStructuredText` with `operation: "merchant_context"`, image inputs, shared provider config, Gemini fallback support, and shared provider-attempt cost telemetry.
- Kept legacy `image_url` requests on the direct OpenAI Responses path because that compatibility shape lets the provider fetch a remote URL instead of sending inline bytes.
- Updated the client result type to accept `extraction_source: "provider_router"`.
- Expanded menu source guards so synthetic fallback remains explicit, base64 scans stay on the router, and direct legacy provider errors remain sanitized.

## Acceptance criteria map

51. No generation path bypasses provider/quality controls: Improved; app-facing base64 menu OCR now shares the provider router. Remaining direct provider paths are live web-search preview, Whisper transcription, legacy menu `image_url` OCR, image generation/edit providers, and existing-deal edit/update compatibility.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run supabase\functions\_shared\ai-extract-menu-source.test.ts`: passed; 1 file, 4 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `git diff --check`: passed; Git warned that touched Markdown/TypeScript working-copy line endings will normalize from LF to CRLF when Git writes them.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run lint`: passed.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run copy:evaluate`: passed; 30 valid, 0 invalid.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `.\node_modules\.bin\vitest.cmd run`: passed; 139 files, 779 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4ap-20260623-2039`: passed with the known `country-flag-icons` package export warnings.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run typecheck:functions -- --pretty false`: blocked because `deno` is not installed/on PATH; all 129 Edge Function files failed for that same missing-command reason.

## Unresolved risks

- Hosted behavior still requires redeploying `ai-extract-menu`; deployment is a hard gate and was not performed.
- Legacy `image_url` menu extraction remains direct until there is a safe provider-neutral URL-fetch/inline-media abstraction.
- Local Edge Function typechecking remains blocked until `deno` is installed or available on PATH.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4aq - Persist ad-generation total latency

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `44c6e6c0`.

Deployment actions: Edge Function redeploy required for hosted behavior to change; not performed here.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-telemetry-source.test.ts`
- `scripts/measure-ai-ad-baseline.mjs`
- `lib/ai-ad-baseline-runner-source.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/ai-ad-baseline-metrics.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Added `total_latency_ms` to the main ad-variant `ai_generation_logs.response_payload`, measured from Edge request entry through the logged generation result.
- Added the same elapsed field to the copy-failure log payload so failed copy attempts still contribute to latency diagnosis.
- Extended the baseline metrics runner to compute total generation latency p50/p95/min/max from `response_payload.total_latency_ms` and added it to the local Markdown dashboard plus calibration watchlist.
- Updated the current-state and baseline docs so they no longer call total generation latency an unimplemented first-class telemetry gap.
- Added source guards for the Edge telemetry field and baseline runner output.

## Acceptance criteria map

7. Per-stage provider/model/latency/token/cache/cost telemetry is stored: Improved; total ad-generation latency is now persisted in the ad-variant log payload without requiring a schema change.
34. Metrics to watch after each release slice: Improved; the local dashboard now exposes full generation p50/p95 once hosted rows include `total_latency_ms`.
51. No generation path bypasses provider/quality controls: Preserved; this slice changes telemetry only.
52. No GPT-5.4-mini versus GPT-5.5 comparison was performed: Confirmed; none performed.

## Validation

- `.\node_modules\.bin\vitest.cmd run supabase\functions\_shared\ai-generate-ad-variants-telemetry-source.test.ts lib\ai-ad-baseline-runner-source.test.ts`: passed; 2 files, 3 tests.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed.
- `git diff --check`: passed; Git warned that touched Markdown/TypeScript/JS working-copy line endings will normalize from LF to CRLF when Git writes them.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run lint`: passed.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run copy:evaluate`: passed; 30 valid, 0 invalid.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run gate:ai-ad`: passed; all 10 AI ad release gate checks passed.
- `.\node_modules\.bin\vitest.cmd run`: passed; 140 files, 781 tests. Existing Expo push negative-path stderr appeared from tests that intentionally exercise error handling.
- `.\node_modules\.bin\expo.cmd export --platform android --output-dir C:\tmp\twofer-metro-probe-codex-ai-pr4aq-20260623-2050`: passed with the known `country-flag-icons` package export warnings.
- `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run typecheck:functions -- --pretty false`: blocked because `deno` is not installed/on PATH; all 130 Edge Function files failed for that same missing-command reason.

## Unresolved risks

- Hosted behavior still requires redeploying `ai-generate-ad-variants`; deployment is a hard gate and was not performed.
- Older `ai_generation_logs` rows and hosted rows before this deploy will not have `total_latency_ms`, so the baseline dashboard may show zero total-latency samples until new rows are produced.
- Local Edge Function typechecking remains blocked until `deno` is installed or available on PATH.

## Rollback

Revert this commit. No migration rollback is required.

---

## PR 4ar - Document AI provider deployment flags

Status: Implemented locally on branch `codex/ai-quality-pr4-rendering-cleanup`.

Safety checkpoint: `09a97514`.

Deployment actions: none performed here. Hosted secret changes, Edge Function redeploys, website privacy/subprocessor deployment, and Supabase migrations remain hard-gated.

Supabase migrations applied: none.

Migrations added: none.

Live secret names changed: none.

## Files changed

- `.env.example`
- `docs/deployment-notes.md`
- `docs/production-deploy-checklist.md`
- `docs/deployment-command-plan.md`
- `TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`

## What landed

- Corrected the example OpenAI chat default from the stale `gpt-4o-mini` wording to the current shared `gpt-5.5` default.
- Added the code-backed Gemini/router/fallback, independent judge, vision QA, cost-budget, circuit-breaker, image-provider, and AI monthly-limit secret names to the deployment docs.
- Preserved production activation gates: keep Gemini text fallback off until the public privacy/subprocessor update is deployed, do not enable circuit-breaker behavior before its migration is applied, and do not set the synthetic menu fallback in production.

## Acceptance criteria map

4. Google/Gemini provider setup is explicit before activation: Improved; deployment docs now list `GEMINI_API_KEY`, model overrides, router/fallback flags, vision QA flags, and Gemini image flags.
6. Provider fallback and circuit breaker are deployment-controlled: Improved; docs now call out the router/circuit flags and the migration prerequisite.
50. Google data flow is documented before activation: Preserved; production docs still require `AI_TEXT_FALLBACK_ENABLED=false` until the public website privacy/subprocessor update is deployed.

Deployment/rollback section: Improved; the command plan and production checklist now include the active code-backed AI provider flags rather than the older partial set.

## Validation

- `git diff --check`: passed; Git warned that touched Markdown/env working-copy line endings will normalize from LF to CRLF when Git writes them.
- `rg -n "OPENAI_MODEL=gpt-4o-mini|leave UNSET to use gpt-4o-mini|gpt-4o-mini   # safe default" .env.example docs/deployment-notes.md docs/production-deploy-checklist.md docs/deployment-command-plan.md`: passed; no stale default text remained in the active deployment docs.
- `rg -n "GEMINI_API_KEY|AI_V3_PROVIDER_ROUTER_ENABLED|AI_TEXT_FALLBACK_ENABLED|AI_CIRCUIT_BREAKER_ENABLED|AI_IMAGE_GEMINI_ENABLED|AI_TRANSLATE_MONTHLY_LIMIT" .env.example docs/deployment-notes.md docs/production-deploy-checklist.md docs/deployment-command-plan.md TWOFER_AI_QUALITY_IMPLEMENTATION_REPORT.md`: passed; deployment docs now include the active provider flag names.

## Unresolved risks

- This is documentation only; hosted behavior still depends on hard-gated secret changes, migrations, public website deployment, and Edge Function redeploys.
- Local Deno Edge Function typechecking remains unavailable until `deno` is installed or available on PATH.

## Rollback

Revert this commit. No migration rollback is required.

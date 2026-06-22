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

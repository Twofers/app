# AI ad copy naturalness plan — 2026-07-26

**Problem (Dan, 2026-07-26):** generated images are good, but the ad words "still don't sound natural or really match what's being advertised."

**This file is the tracker.** Check items off as they land. Nothing below is implemented yet.

---

## Dan's decisions (2026-07-26)

- Every copy surface is affected equally (poster headline, card description, push, share caption).
- Dominant failure: **stiff / robotic** wording. Secondary: doesn't fit the item/business.
- **No grading session.** Agent calibrates from known-bad patterns; Dan judges the end result on device.
- **Flavor words allowed when merchant-supplied.** "Homemade", "fresh-baked", "family recipe" may appear only when the merchant's own text says so; the AI still can't invent them. Certification-style claims (organic, gluten-free, award, #1, best, rated, certified, guarantee, healthy) stay banned everywhere, even if merchant-typed.
- **Judge runs on OpenAI** (Dan, 2026-07-26 "use open ai"): no copy text goes to Gemini for judging. Phase 3 uses the OpenAI-different-model judge variant; the Gemini privacy-gate question is moot for this plan.
- ~~**Deploy HELD**~~ → **DEPLOYED 2026-07-26** (Dan: "deploy it"). The hold applied only between the token fix and the completion of Phases 1.3–4; everything shipped together in one `ai-generate-ad-variants` deploy (v203). See the deploy log below.

## Diagnosis (read-only audit, 2026-07-26)

The pipeline (`ai-generate-ad-variants`) already has: research → merchant creative profile → category playbook → 5 strategy-lane candidates (one JSON call, `AI_COPY_PROMPT_V5`) → banned-phrase style gate → optional cross-provider judge → repair → deterministic fallback. It is well defended against *wrong* copy. It has no mechanism that pushes toward *natural* copy. Four root causes:

1. **Fact starvation.** The model typically gets only item name, category, business name, and a one-line research blurb. Worse: `verifiedMerchantNote()` / `safeDifferentiator()` in `lib/merchant-creative-profile.ts` drop the merchant's **entire** description if it contains one `UNSAFE_FACT_RE` word (fresh, homemade, organic, …). The prompt says flavor words are OK "unless supplied by the merchant" — but they are deleted before the model ever sees them, so that permission can never fire. Saved menu items and website-import text are collected elsewhere but never reach the copy prompt.
2. **Don't-heavy prompt with a cafe voice anchor.** `AI_COPY_PROMPT_V5` is dozens of bans; the single positive voice line tells every category — auto shops, nail salons — to "write like a sharp local cafe ad." Bans + thin facts ⇒ the safest, stiffest sentence that passes.
3. **First-pass-wins selection.** The winner among 5 candidates is effectively the first one that clears the style gate. The built-in candidate judge (Gemini compares all 5, picks best) **defaults OFF** — `envFlag("AI_V3_INDEPENDENT_JUDGE_ENABLED", false)` at `supabase/functions/ai-generate-ad-variants/index.ts:1552` — and also self-skips (same-provider fallback, missing Gemini key, <2 valid candidates).
4. **No naturalness feedback loop.** `npm run copy:evaluate` checks mechanics of the deterministic builder, not live AI output; nothing measures "sounds like a person," so blandness is invisible and unregressable.

## What does NOT change

- Deal facts stay authoritative; locked offer line, schedule, terms stay app-rendered. No copy-quality fix may alter facts.
- No example-specific string replacements (repo rule). All fixes are pattern- or input-level.
- Deterministic fallback stays; validation stays fail-closed.
- Poster-English policy unchanged. es/ko keep flowing through the existing localization stage.
- No image-pipeline changes in this plan.

## Locked-file gate

Everything in Phases 1–3 touches AI-poster-lock scope. **Each file needs Dan's individual approval before edit** (state file, change, visible effect, validation, deploy impact). After approved edits: update `docs/ai-poster-core-lock.json` hash + chained `approvalRef` ("Prior ref:" chain), run `npm run gate:ai-poster-lock`.

| File | Phase | In hash manifest? |
|---|---|---|
| `lib/merchant-creative-profile.ts` | 1 | No (policy still applies) |
| `lib/ad-language-policy.ts` | 1, 2 | No (policy still applies) |
| `lib/ad-copy-style-gate.ts` (+ test) | 1 | No (policy still applies) |
| `lib/category-ad-playbooks.ts` | 2 | No (policy still applies) |
| `supabase/functions/ai-generate-ad-variants/prompt.ts` (+ `prompt.test.ts`) | 2 | **Yes** |
| `supabase/functions/ai-generate-ad-variants/index.ts` | 3 | **Yes** |
| `lib/candidate-judge.ts` (+ test) | 3 | No (policy still applies) |
| `fixtures/*` copy fixtures, `scripts/evaluate-ai-promotional-copy.mjs` | 2, 4 | Yes (fixtures/eval named in lock doc) |

Deploy impact: Phases 1+2 ship as **one** `ai-generate-ad-variants` deploy (Dan-gated). Phase 3 is an Edge secret change + possibly the same function again. No app rebuild expected (server-side copy path); if Phase 1 gate changes turn out to be bundled client-side (quick-deal validation), note it and keep server as the enforcement point.

---

## Phase 0 — Verify production reality (read-only, no approvals) — ✅ DONE 2026-07-26

Run with Dan's approval via linked-CLI service key (never printed). Outputs: `qa-artifacts/ai-copy-baseline-2026-07-26/` (`ai-ad-baseline.{json,md}`, `copy-corpus.json`, `copy-corpus-report.md`, extractor script). 30-day window, 183 generations.

- [x] **0.1 Copy model in prod: `gpt-5.4-mini`** — every one of 183 log rows and all 216 copy provider attempts. The gpt-5.5 default never applies; prod `OPENAI_MODEL` pins the mini model.
- [x] **0.2 Judge confirmed OFF in prod.** `feature_flag_disabled` × 99 skips, 0 judge attempts ever. Decision recorded: Phase 3 uses OpenAI-different-model judge (no copy text to Gemini).
- [x] **0.3 BEFORE corpus captured** (60 rows). Payload shape: headline at `generated.headline`, description at `generated.offer`.

**Phase 0 findings that reorder the plan:**

1. **43.5% deterministic-fallback rate** (73/168 rows) — nearly half of published ads carry the plain template copy, not AI copy. A large share of the "stiff" feeling is the fallback itself, reached because…
2. **33% of copy attempts return invalid output** (`provider_output_invalid` 72/216, plus 4 timeouts); repair rate 48.8%, validation-failure rate 35.7%. gpt-5.4-mini struggles to emit the strict 5-variant JSON. Suspect output-token exhaustion (same failure class as the July image `empty-content` fix) and/or schema size.
3. **Instruction leakage into customer copy:** live example `generated.offer` = "Save 40% on one latte, clearly and simply." — prompt-rule language surfacing in the ad. Also shipped: mangled headlines "Coffee and a free to" / "Coffee in, to free" (both `AI_VALIDATED`), and "one THE SERGEANT'S STRIPES" (article + verbatim all-caps item name).
4. Offer-echo double-restate pattern: headline "40% off one latte" + description "Save 40% on one latte…" — same fact twice, zero hook.
5. Cost headroom: total AI spend $33.00/30d, avg $0.094/request group (images dominate). A copy-model bump costs pennies per generation.

**New highest-leverage item → Phase 1.0 added below** (model bump + invalid-output fix) — likely cuts the fallback rate from 43% toward single digits before any prompt rewrite.

## Phase 1 — Unstarve the inputs

- [x] **1.0(a) Copy model bump — LIVE IN PROD 2026-07-26 ~15:54 UTC.** `OPENAI_MODEL` Edge secret set to `gpt-5.5` via CLI (Dan approval "yes to both"); digest confirmed in `secrets list`. Takes effect per invocation, no redeploy. Scope note: this secret drives ALL OpenAI text features through `_shared/openai-chat-model.ts` (copy, research, suggestions, translation), not just ad copy — acceptable at $33/30d volume; watch next baseline.
- [x] **1.0(b) Invalid-output FIXED IN CODE (2026-07-26, Dan "fix this now"; staged, NOT deployed).** Ledger probe pinned the mechanism exactly: **136 of 148 failed ad_copy provider calls (30d) were `OPENAI_EMPTY_CONTENT`** — reasoning consumed the whole combined cap and returned zero visible text — plus 9 `OPENAI_FETCH_FAILED` (12s timeout aborts). History: the July empty-content fix ran this call at medium effort (cap 1400+2048=3448, which killed the error); the 07-07 switch to low effort for latency silently shrank the reserve to 512 (cap 1912), reintroducing it. Fix in `ai-generate-ad-variants/index.ts`: `maxOutputTokens` 1400 → 3000 (cap 3512, clears the historically-proven 3448) and `timeoutMs` 12s → 18s (so longer thinks complete instead of converting into timeout aborts); `reasoningLevel` stays low. `_shared/openai-chat-model.ts` untouched. Lock manifest re-stamped (new sha256 + chained approvalRef). Validation: gate 30/30, `typecheck:functions`, full suite 2040/2040, `copy:evaluate` 43/43. Success metric unchanged: fallback 43% → <10% on the post-deploy baseline.
- [x] **1.1 Description wipe fixed (2026-07-26, local — deploys with Phase 1+2 batch).** `UNSAFE_FACT_RE` replaced by sentence-level cleaning: `MERCHANT_ALWAYS_BANNED_CLAIM_PATTERN` drops only the sentence containing a certification/comparative/health/guarantee claim ("locally sourced" kept banned as a sourcing claim); the rest of the merchant's text survives into notes and differentiators. New `MERCHANT_SUPPLIED_FLAVOR_PATTERN` (homemade, house-made, scratch-made, hand-crafted/-made, fresh/freshly(-baked/brewed/made/squeezed), family recipe, family-owned). Both exported from `lib/ad-language-policy.ts`. Profile version bumped to `merchant-creative-profile-v2`.
- [x] **1.2 Merchant-supplied flavor phrases wired to the prompt (2026-07-26, local).** Profile now carries optional `merchantSuppliedPhrases` (collected from merchant-typed description/notes/itemHint only — never AI research); the profile prompt block tells the model it may use exactly those phrases, and states "none — do not use flavor or preparation claims the merchant did not write" otherwise. **Style gate needed NO edit** (verified: none of the gate's pattern lists contain these flavor words, and `HYPE_WITHOUT_SPECIFICITY` already passes when the item is named), so `lib/ad-copy-style-gate.ts` stays untouched — one less locked-file diff. Reaches prod only when `ai-generate-ad-variants` next deploys.
- [x] **1.3 Richer verified context (2026-07-26, local — rides the held deploy).** The handler best-effort fetches up to 6 owner-saved `business_menu_items` names (a fetch failure never blocks generation) and threads `savedMenuItemNames` into both profile-build sites. The profile carries them as `savedMenuItems` verified facts plus a context-only prompt line ("the offer stays exactly as locked — never move the deal onto these"), includes them in merchant-supplied flavor collection, filters claim-bearing names ("Award-Winning Ribs"), and they clear `merchantSpecificContextLimited`. Website-import description was verified to already reach the prompt via client-sent `business_context.description` — no extra plumbing needed.
- [x] **1.4 Validation green (2026-07-26):** poster-lock gate 30/30 unchanged; vitest full suite 287 files / 2040 tests pass (profile tests extended to 5, incl. sentence-level keep/drop, certification-claim exclusion, prompt-block rendering); `typecheck` + `typecheck:functions` + `lint` + `copy:evaluate` (43/43 fixtures valid) all clean.

## Phase 2 — Rewrite the voice half of the prompt (V5 → V6) — ✅ DONE 2026-07-26 (local, rides the held deploy)

- [x] **2.1 Per-category voice anchor.** All 18 `category-ad-playbooks.ts` entries gained a one-line `voiceAnchor` (cafe: barista's chalkboard; auto: trusted neighborhood mechanic's board; spa: calm front-desk card; …). The playbook prompt block renders "Voice anchor: write like …" and the V6 VOICE section defers to it — the global "sharp local cafe ad" line is gone.
- [x] **2.2 Voice examples per category.** Every category carries 2 headline+description pairs (36 total), rendered only for the active category, labeled "tone and rhythm only; the real offer's items, numbers, and mechanics always win." All example headlines are poster-safe (≤28 chars, no value-word endings — enforced by a new playbook test). **Dan: eyeball the example lines in the `category-ad-playbooks.ts` diff — this is your review checkpoint in lieu of the skipped grading session.**
- [x] **2.3 Pruned redundancy:** the free-floating "Avoid generic marketing language" rule removed (style gate enforces it mechanically; in-code comment records why). Structural rules all kept.
- [x] **2.4 Say-it-out-loud rule** added to VOICE, plus a ban on planning vocabulary reaching customer copy ("clearly and simply" et al. — the live leak from the baseline corpus).
- [x] **2.5 Version bump** `AI_COPY_PROMPT_V6` everywhere: `AD_COPY_PROMPT_VERSION`, the rules array, and the mechanically-required sync of `lib/ad-spec.ts` `AD_SPEC_V3_COPY_PROMPT_VERSION` (its test pins equality; `validateAdSpecV3` has no runtime callers, so no stored spec re-validates). `prompt.test.ts` updated (V6 assertions + per-category-register regression test). copy:evaluate 43/43.

## Phase 3 — Make the best-sounding draft win

- [x] **3.1 Judge on OpenAI — built 2026-07-26 (local, rides the held deploy).** `makeJudgeConfig` now forces OpenAI primary with fallback off; `resolveJudgeOpenAiModel` uses env `AI_JUDGE_OPENAI_MODEL` when set, allowlisted, AND different from the generator, else a deterministic different-model default (mini judges gpt-5.5; gpt-5.5 judges a mini). The gemini-era skips (`same_provider_fallback`, `gemini_api_key_missing`) are gone — a Gemini-generated fallback batch now gets judged cross-provider. Gemini vision image QA untouched. No copy text goes to Gemini.
- [x] **3.2 Judge rubric v2** (`candidate-judge-v2`): say-it-out-loud reading, category/item fit, instantly-clear exchange, and a hard-fail for planning-vocabulary echoes — on top of the existing 8-dimension scoring. Blind prompt (no provider identity) preserved and still pinned by test.
- [x] **3.3 ENABLED IN PROD 2026-07-26** (after the deploy, never before). `AI_V3_INDEPENDENT_JUDGE_ENABLED=true`; `AI_JUDGE_OPENAI_MODEL` left unset so the deterministic default applies (generator gpt-5.5 → judge gpt-5.4-mini). Cost/latency: one extra small text call (~1–2 s); telemetry records judge usage, winner, model, latency.

## Phase 4 — Naturalness regression net + proof

- [x] **4.1 Stiff-pattern detectors — live in the production style gate (2026-07-26, rides the held deploy).** Three new gate reasons, all pattern-level: `INSTRUCTION_LEAK_PHRASE` (`AD_COPY_INSTRUCTION_LEAK_PATTERNS` in `ad-language-policy.ts`), `TRUNCATED_FRAGMENT` (`endsInDanglingFunctionWord` — punctuated sentences never match), and `QUANTITY_ARTICLE_COLLISION` (`hasQuantityArticleCollision` — "one, the second is free" does not match). Each has repair guidance in `QUALITY_GATE_REPAIR_GUIDANCE`. ALL-CAPS normalization and cross-field offer-echo deliberately left out of the hard gate (echo is report-only in 4.2's tool; diversity thresholds already warn).
- [x] **4.2 Naturalness eval built + BEFORE run done:** `scripts/evaluate-ad-copy-naturalness.mjs` — deterministic pass reuses the REAL production gate + poster predicates (zero drift) plus a report-only offer-echo check; optional LLM pass activates when `OPENAI_API_KEY` is set (not CI-wired). BEFORE-corpus result: **18/60 rows flagged** — offer-echo ×13, quantity-article ×3, instruction-leak ×1, truncated ×2, formulaic ×1 — every defect we found by eye is now caught mechanically. Report: `qa-artifacts/ai-copy-baseline-2026-07-26/naturalness-report.{md,json}`.
- [ ] **4.3 DEPLOY-DAY: AFTER corpus + side-by-side.** Needs the deployed pipeline: regenerate comparable offers, re-run the corpus extractor + naturalness script + baseline, side-by-side vs the BEFORE artifacts, S10 eyeball pass by Dan.
- [x] **4.4 Ongoing signal:** `measure-ai-ad-baseline.mjs` now reports `accepted_by_user_rows`/`accepted_by_user_rate` from generation logs. True merchant *edit* rate stays blocked on the known `publish_events`/generation-id gap (documented in the baseline doc); acceptance rate is the available proxy.

## Dan inputs needed before work starts

1. ~~`OPENAI_MODEL` value in prod~~ ✅ answered by baseline run: `gpt-5.4-mini`.
2. ~~Gemini-judge privacy call~~ ✅ decided: judge on OpenAI.
3. ~~Per-file approvals~~ ✅ "yes to both" (1.1/1.2 files), "fix this now" (index.ts token fix), "/goal complete all remaining phases" (remaining enumerated files) — all recorded as chained refs in `docs/ai-poster-core-lock.json`.
4. ~~`OPENAI_MODEL` → gpt-5.5~~ ✅ LIVE in prod since 2026-07-26 ~15:54 UTC.

## Status 2026-07-26: ALL PHASES COMPLETE AND **DEPLOYED TO PRODUCTION**

Every code phase is implemented, validated, and **live**. Pre-deploy battery: poster-lock gate 30/30, app + functions typechecks, lint, **2050/2050 tests**, copy:evaluate 43/43, naturalness BEFORE report. No app rebuild was needed — all changes are server-side (`lib/functions.ts`, `app/create/ai.tsx`, and the client request shape untouched). **Code is still UNCOMMITTED** (house rule: commit only when Dan asks).

## Deploy log — 2026-07-26 (Dan: "deploy it")

1. ✅ **Function deployed:** `ai-generate-ad-variants` → **version 203, ACTIVE**. Ships the token/timeout fix (1.0b), merchant-description + flavor words (1.1/1.2), menu-item context (1.3), prompt V6 (2.x), the OpenAI judge (3.1/3.2), and the three new gate reasons (4.1).
2. ✅ **Judge enabled after the deploy:** `AI_V3_INDEPENDENT_JUDGE_ENABLED=true`. Ordering respected — the flag was never set while the old Gemini-judge code was live. `AI_JUDGE_OPENAI_MODEL` deliberately left unset, so the deterministic default applies: generator `gpt-5.5` → judge `gpt-5.4-mini` (different models, as designed).
3. ✅ **Boot smoke test:** unauthenticated POST returns the app's own `401 {"error":"Unauthorized. Please log in."}` — not a Deno boot error — proving the new module graph (new policy exports, gate predicates, playbook voice fields, judge v2, profile v2) resolves at runtime and the handler executes.
4. ⏳ **Device verification (Dan):** make 2–3 test generations on the S10. Expect in `ai_generation_logs`: `prompt_version=AI_COPY_PROMPT_V6`, judge telemetry populated (`used=true`, an OpenAI provider/model, a winner id), copy source `AI_VALIDATED`.
5. ⏳ **Measure (after a few days of traffic):** re-run `scripts/measure-ai-ad-baseline.mjs` — deterministic-fallback rate target **43% → <10%**, watch p95 copy latency and cost per request group — then the corpus extractor + `scripts/evaluate-ad-copy-naturalness.mjs` for the AFTER report (4.3), side-by-side vs `qa-artifacts/ai-copy-baseline-2026-07-26/`.
6. ⏳ **Commit** when Dan asks.

## Post-deploy observation #1 — 2026-07-26 ~17:39–17:53 UTC (Dan's 6 test deals)

**Verified working:**
- V6 live on `gpt-5.5`; `prompt_version=AI_COPY_PROMPT_V6` on all 6 rows.
- **Empty-content is gone.** Successful calls used 1153/1135/1234 output tokens against the new 3000 budget, `reasoning_tokens=0`. Zero `OPENAI_EMPTY_CONTENT` — the 1.0(b) fix did its job.
- **Judge runs and is genuinely independent:** `openai/gpt-5.4-mini` judging `gpt-5.5` output, ~5.5–5.9s, real rankings, and its feedback quotes the new voice anchors ("feels more like a local cafe chalkboard note… leans more generic promo copy than something a barista would naturally post").
- **Voice improved:** "Sundae first, coffee free" / "Buy an ice cream sundae and the coffee is on us." (vs V5's "Save 40% on one latte, clearly and simply.")
- **New gate fires on real defects:** three candidates rejected `QUANTITY_ARTICLE_COLLISION` on "THE GREEN BRIEFING (Matcha)" — the model was writing "40% off one THE GREEN BRIEFING".

**Regression found — 3/6 fell back to template copy, all `error_class=timeout`:**
- Root cause: **the per-call `timeoutMs` is dead code.** `ai-text-provider.ts:269` does `const providerRequest = { ...request, timeoutMs }` where `timeoutMs` is the *config's* `primaryTimeoutMs` — so the copy call's `timeoutMs: 18_000` never applied and the real ceiling stayed `AI_TEXT_PRIMARY_TIMEOUT_MS` (default **15s**). gpt-5.5 takes **13.4–15.7s** on this call, so it was a coin flip. The judge hit its own 9s `AI_JUDGE_TIMEOUT_MS` ceiling once (successful judge calls run 5.5–5.9s).
- Latency context: copy is NOT the wall-clock driver — image ran 13–91s of the 34.8–116.9s totals.
- **Fix applied (Dan approved, secrets only, no deploy): `AI_TEXT_PRIMARY_TIMEOUT_MS=25000`, `AI_JUDGE_TIMEOUT_MS=15000`** (both set 2026-07-26 21:32 UTC). Note `AI_TEXT_PRIMARY_TIMEOUT_MS` is shared by other text operations (research, translation, compose).

**Open follow-ups (need a deploy; not yet approved):**
1. Make the per-call `timeoutMs` actually win over `config.primaryTimeoutMs`, or delete the misleading dead parameter from the copy call.
2. Prompt rule for article-leading item names ("THE GREEN BRIEFING", "THE LIEUTENANT'S CUP") so the model stops generating "one THE …" — the gate correctly kills those candidates, but 3 of 5 died at once, leaving a weaker survivor ("…gets the spotlight with 40% off one."). Same family as the known "The &lt;item&gt;" publish blocker.
3. Re-verify fallback rate after the timeout change with a fresh batch, then run the AFTER corpus.

### Rollback (if the new copy misbehaves)

- Judge only: set `AI_V3_INDEPENDENT_JUDGE_ENABLED=false` (instant, no deploy) — copy selection falls back to deterministic ranking.
- Model only: set `OPENAI_MODEL=gpt-5.4-mini` (instant, no deploy).
- Everything: redeploy `ai-generate-ad-variants` from a checkout without these changes (the code is uncommitted, so preserve the working tree first).

## Validation matrix

Baseline `npm run typecheck && npm run lint && npm test` (pretest runs the poster-lock gate) on every phase; `npm run typecheck:functions` + `npm run copy:evaluate` + focused tests for Phases 1–3; lock JSON hash + chained approvalRef after each approved locked-file edit; no deploys or secret changes without explicit approval.

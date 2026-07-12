# Site-Import Menu Extraction Reliability Plan (Finding #2)

Status: PLANNED (2026-07-08). No code written. Implementation, deploys, secrets, and builds are all Dan-gated per CLAUDE.md.
Problem: `import-business-website` intermittently returns `MENU_EXTRACTION_FAILED` — the menu-structuring AI call throws at the provider layer. Observed during S10 QA on 2026-07-08: failed for both example.com (~200 chars of text) and ascension.coffee, then succeeded for velvettaco.com minutes later. Failure on a tiny prompt proves it is provider-layer (auth/quota/circuit/transient), not content- or prompt-size-related. The feature already degrades correctly (returns logos + warning, `ok:true`), so this plan is about raising the menu hit-rate, not fixing a crash.

Dan approved planning "even if it includes another API" — Phase 2 adds Anthropic Claude as a tertiary extraction provider.

---

## 0. Ground rules

- Read CLAUDE.md first; all hard gates apply (no deploys, no secrets, no builds without approval).
- Locked files: none of the files this plan touches are in `docs/ai-poster-core-lock.json`. Verified: `supabase/functions/_shared/ai-text-provider.ts`, `ai-costs.ts`, `site-import.ts`, `import-business-website/index.ts`, `app/business-setup.tsx`, and locale files are all unlocked. (`_shared/ai-image-provider.ts` and `dalle-image.ts` ARE locked — do not touch.)
- Do not modify `ai-extract-menu` (plan §0.2 of the original feature plan: reuse patterns, not code paths). The same provider-layer weakness affects the camera menu scanner, but fixing it there is explicitly out of scope here.

---

## 1. Phase 0 — Diagnose before building (read-only, no gates)

The ledger already has the answer: every menu attempt is logged to `ai_generation_costs` with `feature='site_import'`, provider, and errorCode.

1. **Pull failure rows.** Read-only SQL (Dan runs it in the dashboard SQL editor, or via the existing website admin AI Operating Report which reads the same table):
   ```sql
   SELECT provider, model, error_code, success, created_at
   FROM ai_generation_costs
   WHERE feature = 'site_import'
   ORDER BY created_at DESC
   LIMIT 50;
   ```
   Interpretation table:
   | errorCode seen | Root cause | Which fix below |
   |---|---|---|
   | `AI_PROVIDER_CIRCUIT_OPEN` | Circuit breaker open (AI_CIRCUIT_BREAKER_ENABLED=true on prod; failures from OTHER features open the shared gemini/openai `text_generation` circuits and site-import fails fast) | W3 + Phase 2 |
   | `insufficient_quota` / `HTTP_429` on openai rows | OpenAI quota (known incident 2026-07-07) — fallback leg dead, so any Gemini blip becomes a hard failure | Dan re-funds OpenAI; Phase 2 removes the single-fallback dependency |
   | `GEMINI_EMPTY_CONTENT` / `GEMINI_JSON_PARSE_FAILED` | Gemini output truncation/format (thinking-reserve class of bug) | W1/W2 + Phase 2 |
   | timeout / `*_FETCH_FAILED` | 15s/14s effective timeouts too tight (see W1) | W1 |
2. **Check circuit-breaker state**: read `ai_provider_circuit_breakers` (same read-only route) for open circuits and failure counts at the QA timestamps (~2026-07-08 18:00–18:10 local).
3. **Confirm OpenAI quota is restored** from recent successful `provider='openai'` ledger rows in any feature (no paid test call needed).

Exit criteria: we know which row of the table above we're in before writing code. Phase 1 is worth doing regardless; Phase 2's justification is strongest if the answer is "circuit open / fallback dead".

### Phase 0 RESULT (2026-07-08, ledger read via `supabase db query --linked`)

The hypothesis table above was **wrong** — this is not a quota/circuit/timeout problem. The ledger is unambiguous:

- `feature='site_import'`, `provider='gemini'` (`gemini-3.5-flash`): **3/3 FAIL with `error_code='INVALID_ARGUMENT'`** (a deterministic 400 bad-request from Gemini `generateContent`, not a transient error).
- `feature='site_import'`, `provider='openai'` (`gpt-5.4-mini`): **OK**.
- Cross-feature check (30 days, all Gemini): `INVALID_ARGUMENT` appears on **site_import only**. The same `gemini-3.5-flash` runs `image_qa` **122/122 OK**, and `ad_copy` requests are *accepted* (they fail later at `GEMINI_JSON_PARSE_FAILED`, i.e. a different, output-side issue). The camera menu scanner (`feature='menu_extraction'`, which uses the identical `menuSchema`) has **zero** Gemini rows in 30 days — consistent with its Gemini path also never succeeding.

**Conclusion:** Gemini deterministically rejects the site-import menu request (something specific to this call — most likely the `menuSchema` → `geminiResponseSchema` output or the `thinkingConfig`), so every "success" has silently ridden the OpenAI fallback, and a scan only fails when OpenAI *also* has a bad moment. The intermittency was OpenAI's, layered on top of an always-failing Gemini primary.

**EXACT ROOT CAUSE — FOUND + FIXED 2026-07-08.** Reproduced the transformed `responseSchema` offline (ran `geminiResponseSchema(menuSchema)` in a throwaway vitest). The menu-item object came out with `name` **missing from `properties`** but still listed in `required` — Gemini rejects "required property not in properties" as `INVALID_ARGUMENT`. Cause: `stripUnsupportedSchemaKeywords` in the shared `_shared/gemini-text-provider.ts` stripped every key literally named `"name"` at any depth (intended only to drop the OpenAI wrapper's top-level `name`), so it deleted the legitimate `properties.name` field. This corrupts **any** schema with a `name` property — exactly `menuSchema`, used by both site_import and `ai-extract-menu` (which is why the camera scanner also had zero Gemini successes). Fix: only strip `name`/`strict` at the schema root (`atRoot` flag); keep stripping `additionalProperties` at every depth. Added a `geminiResponseSchema` regression test. Full suite 1410 pass (shared file → all Gemini callers exercised). With the primary fixed, `menuTextConfig` is restored to **Gemini-primary / OpenAI-fallback** (the W0 flip is reverted — no longer needed).

> **Also benefits (not redeployed here):** `ai-extract-menu`'s Gemini path had the same latent failure. It gets the fix when it's next redeployed; not done in this change to keep the deploy scoped to site_import. Flag for a follow-up redeploy if the camera menu scanner's Gemini leg matters.

---

## 2. Phase 1 — Cheap robustness fixes (no new API) — IMPLEMENTED 2026-07-08 (uncommitted, not deployed)

Small diffs, all in unlocked files. **W0 is the headline fix** given the Phase 0 result; W1–W5 are supporting hardening.

**W0 — Flip the text menu path to OpenAI-primary, Gemini-fallback.** `menuTextConfig()` in `import-business-website/index.ts` now sets `primaryProvider: "openai", fallbackProvider: "gemini", fallbackEnabled: true`. Leading with the provider that actually works removes a guaranteed-failing first attempt (latency + a FAIL ledger row) on the happy path; Gemini stays as fallback so an OpenAI blip still gets a shot (and starts working the moment the Gemini INVALID_ARGUMENT bug is fixed). `menuPdfConfigGeminiOnly()` is **unchanged** — Gemini is the only provider that reads PDFs. Source-guard test locks the routing + rationale.

**W1 — Fix the silent timeout override.** `generateStructuredText` ignores the request's `timeoutMs` and uses `config.primaryTimeoutMs` (default **15s**) / `fallbackTimeoutMs` (**14s**) — see `ai-text-provider.ts` `runWithBreaker(...)`/`resolveAiTextProviderConfig`. The edge fn passes `timeoutMs: 20_000` believing it applies; it does not. Fix: `menuTextConfig()` and `menuPdfConfigGeminiOnly()` in `import-business-website/index.ts` set `primaryTimeoutMs: 20_000, fallbackTimeoutMs: 20_000` explicitly (config-object overrides win). Keep the fn's own `timeoutMs` in sync.

**W2 — Cap the LLM prompt text.** Add `MAX_MENU_PROMPT_CHARS = 12_000` in `_shared/site-import.ts` and slice `menuText` before building the user prompt (htmlToMenuText's 20k cap stays for extraction). 12k chars ≈ 3k tokens — faster, cheaper, less truncation risk; menus that long are rare and the tail is usually footer noise. Unit test the cap.

**W3 — Enable the retry the router already has.** In the two config builders set `retryAfterFullTimeout: true` (router's `transientRetryMax` is already 1, but timeout-class errors skip the retry unless this flag is on). Circuit-open failures should stay fail-fast (they are immediate-fallback class already) — no change there.

**W4 — Client "Try again" for the menu-failed case.** In `app/business-setup.tsx`: when `siteImportResult.menu === null` and warnings include `MENU_EXTRACTION_FAILED`, render the existing notice line plus a small SecondaryButton that re-runs `onImportWebsite()` (each retry consumes one of the 10 daily scans — acceptable). New keys `businessSetup.import.menuRetryNotice` + `menuRetryButton` in en/es/ko ("We found your menu but couldn't read it. Try again." / "Try again"). Distinct from `menuNotFound` (site genuinely has no menu → no retry nudge).

**W5 — Distinguish `MENU_BUSY`.** In the edge fn's menu catch block, if the thrown error's `errorCode === "AI_PROVIDER_CIRCUIT_OPEN"`, push warning `MENU_BUSY` instead of `MENU_EXTRACTION_FAILED` so the client copy can say "busy right now — try again in a minute" and ops can tell circuit-open apart in one glance. Source-guard test asserts the mapping.

Validation: `npm test` (helper + wrapper + source-guard updates), `npm run typecheck`, `lint`, `typecheck:functions`. 🔒 Redeploy `import-business-website` (Dan). W4 needs an app rebuild to reach the device (Dan).

---

> **Phase 1 status:** W0–W5 implemented in the working tree, gates green (site-import focused 115 pass; full suite 1409 pass; typecheck + typecheck:functions + lint clean). **Not committed, not deployed** — the live prod edge fn still leads with Gemini until Dan approves a redeploy, so http-site and Gemini-primary behavior on the S10 APK is unchanged until then. W3's client "Try again" needs an app rebuild to reach the device.

## 3. Phase 2 — Anthropic Claude as tertiary extraction provider (the "another API")

> **Phase 0 downgraded this.** With W0, the working provider (OpenAI) is now primary, so reliability no longer hinges on a single fallback leg — Phase 2 is **not needed for reliability** and should not be built preemptively. Reconsider it only if (a) OpenAI reliability itself becomes a recurring problem, or (b) the Gemini INVALID_ARGUMENT follow-up proves unfixable and true two-provider redundancy is wanted. The design below stands if that day comes. The higher-value latent work is the separate Gemini-schema follow-up (fix the primary so it's a real second provider *and* fixes the camera menu scanner's Gemini path).

### 3.1 Shape: scoped fallback, NOT a router change

Do **not** add a third provider to the shared router (`AiProviderName` union in `_shared/ai-provider-errors.ts` + circuit-breaker capability tables + cost budget touch every AI feature in the app — huge blast radius). Instead:

- New module `supabase/functions/_shared/anthropic-text-provider.ts` exposing one function, `generateAnthropicStructuredJson({ apiKey, model, systemPrompt, userPrompt, jsonSchema, maxOutputTokens, timeoutMs })`, mirroring the shape/testing style of `gemini-text-provider.ts`.
- Used **only** by `import-business-website`: `router (gemini → openai) fails` → `if ANTHROPIC_API_KEY set && AI_SITE_IMPORT_TERTIARY_ENABLED === "true"` → one Claude attempt → on success proceed, on failure keep today's warning path. Never blocks the response; never leaks upstream bodies (CLAUDE.md rule — reuse the source-guard pattern).
- Later, if it proves itself, lifting it into the shared router (and giving `ai-extract-menu` the same safety net) is a separate Dan-approved project.

### 3.2 Model + cost (Dan decision — surfaced, not assumed)

| Option | Model ID | Pricing (per MTok in/out) | Per-scan worst case (~3k in / 1.6k out) | Notes |
|---|---|---|---|---|
| **Recommended** | `claude-haiku-4-5` | $1 / $5 | ≈ $0.011 | Matches the flash/mini class of the incumbent providers; supports structured outputs; 200K context (plenty for 12k chars) |
| Alternative | `claude-opus-4-8` | $5 / $25 | ≈ $0.055 | Anthropic's default recommendation for new integrations; overkill for grounded line-item extraction that gemini-flash already handles when healthy |

Recommendation: Haiku 4.5 — this is a high-volume, low-stakes fallback where the primary path is already a flash-tier model; grounded extraction with a strict schema is squarely in its lane. Dan picks.

### 3.3 API call (verified against current API reference, not memory)

- Endpoint: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key: <ANTHROPIC_API_KEY>`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- **Structured outputs**: pass `output_config: { format: { type: "json_schema", schema: <adapted menu schema> } }` — supported on Haiku 4.5 and Opus 4.8; guarantees parseable JSON matching the schema. Our `menuSchema.schema` is compatible as-is (basic types, `required`, `additionalProperties:false`; no unsupported keywords). Adapter strips the OpenAI wrapper (`name`/`strict`) the same way `geminiResponseSchema()` does.
- Body: `{ model, max_tokens: 1600, system: <same systemPrompt>, messages: [{ role: "user", content: buildSiteMenuPrompt(cat) + "\n\nWEBSITE TEXT:\n" + menuText }], output_config: {...} }`. No `thinking` param, no `temperature` (omit both).
- Client: **raw `fetch` with `AbortSignal.timeout(timeoutMs)`**, deliberately mirroring the sibling `gemini-text-provider.ts` / `openai-text-provider.ts` modules rather than pulling `@anthropic-ai/sdk` into the Deno bundle. (Noted deviation from the SDK-first default; consistency with the repo's provider modules, vitest testability, and edge bundle size are the reasons. If Dan prefers the official SDK, `npm:@anthropic-ai/sdk` works on Supabase Edge and the module contract stays identical.)
- Response handling: check HTTP status (401/403 → configuration, 429/5xx/529 → transient, else provider error — never echo the body); check `stop_reason` — `end_turn` → parse the single text block as JSON → `normalizeMenuItems`; `max_tokens` → treat as truncation failure; `refusal` → failure (do not retry). Defensive JSON.parse with a typed error, same as the Gemini module.

### 3.4 Cost ledger

- `logAiCost(admin, { feature: "site_import", provider: "anthropic", model, endpoint: "messages", usage, ... })` for success and failure. Anthropic's `usage.input_tokens`/`output_tokens` map directly onto the ledger's normalizer.
- Add a pricing entry to the (unlocked) pricing map in `_shared/ai-costs.ts`: `"claude-haiku-4-5": { textInputPer1M: 1, textCachedInputPer1M: 0.1, textOutputPer1M: 5 }` so the admin AI Cost by Feature report prices the rows instead of flagging `UNKNOWN_MODEL`.

### 3.5 Config / secrets (all 🔒 Dan)

- `ANTHROPIC_API_KEY` — new prod Supabase secret (Dan creates the key in the Anthropic console and sets it; never in chat/commits).
- `AI_SITE_IMPORT_TERTIARY_ENABLED` — explicit on-switch (default off) so the deploy is inert until flipped; `AI_SITE_IMPORT_TERTIARY_MODEL` optional override, allowlisted to the two models above (invalid → haiku), mirroring the repo's model-allowlist habit.

### 3.6 ⚠ Privacy / policy gate (needs Dan before enabling)

Sending business-website text to Anthropic makes Anthropic a new AI subprocessor. Repo precedent: the Gemini image activation required the public privacy/subprocessor update **first** (see `AI_TEXT_FALLBACK_ENABLED` note in docs/deployment-command-plan.md §5.3). Same treatment here: update the privacy policy/subprocessor list before `AI_SITE_IMPORT_TERTIARY_ENABLED=true` in prod. Content is business-owned public website text (no customer PII), which should make the update small — but it is Dan's call and blocks the flip, not the code.

### 3.7 Tests

- `_shared/anthropic-text-provider.test.ts`: schema adaptation (wrapper stripped, `additionalProperties` kept), request-body snapshot (model/max_tokens/system/prompt/output_config), response parsing (happy path, `max_tokens` stop, refusal, non-2xx per class, malformed JSON), no-body-leak assertions.
- `import-business-website` source-guard additions: tertiary only fires behind key+flag; ledger logs `provider: "anthropic"`; failure still yields `menu: null` + warning (never a 5xx).
- Full gates: `npm test`, `typecheck`, `lint`, `typecheck:functions`. No prompt change (reuses `buildSiteMenuPrompt` verbatim → existing snapshot still covers it; if any prompt wording changes, update fixture per CLAUDE.md).

---

## 4. Ship sequence (every step 🔒 Dan-approved, in order)

1. Phase 0 diagnosis readout (read-only) → confirm/adjust plan.
2. Implement Phase 1 (W1–W5) → gates green → commit → deploy `import-business-website` → verify a live scan.
3. If menu reliability is still unsatisfactory (or diagnosis showed circuit/fallback exposure): implement Phase 2 → gates green → commit → privacy/subprocessor update (Dan) → set `ANTHROPIC_API_KEY` (Dan) → deploy fn (Dan) → flip `AI_SITE_IMPORT_TERTIARY_ENABLED=true` (Dan).
4. Live smoke: scan 2–3 real sites; verify `site_import` ledger rows (incl. `provider='anthropic'` on an induced router failure if practical); confirm client Try-again path on device (needs the W4 rebuild).
5. Rollback at any point: flip `AI_SITE_IMPORT_TERTIARY_ENABLED` off / unset key (Phase 2), or redeploy prior fn (Phase 1). No schema changes anywhere in this plan.

## 5. Acceptance criteria

- [ ] Phase 0: failure modes identified from ledger + breaker table, written into this doc.
- [ ] Menu call effective timeout is actually 20s (W1) and prompt ≤ 12k chars (W2); tests prove both.
- [ ] Circuit-open surfaces as `MENU_BUSY`; owner sees a retry affordance for transient failures (W4/W5) in en/es/ko.
- [ ] Phase 2 (if built): router failure + healthy Anthropic ⇒ menu items returned; ledger shows priced `provider='anthropic'` rows; flag off ⇒ byte-identical behavior; no upstream bodies in responses/logs.
- [ ] All gates green; no locked file touched; nothing deployed/enabled without Dan.

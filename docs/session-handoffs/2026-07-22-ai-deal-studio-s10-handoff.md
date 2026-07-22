# AI Deal Studio S10 session handoff

Generated for Dan at the stopping point of the July 21-22, 2026 Codex session.

This file intentionally does not record any passwords, Supabase secrets, auth tokens, service-role keys, QR/claim codes, or other sensitive values that were pasted during the session. Those values should be considered exposed in chat history and rotated outside this file.

## Starting request

Dan reported this S10 device bug:

- He was logged into the S10.
- He created a deal using the AI poster style.
- He selected `Use deal`.
- On the next page, trying to edit the poster-style subheadline kicked him back to Create Deal.
- Expected behavior: every editable text field on the poster-style ad/review screen should remain editable, preserve edits, and not navigate away unless the merchant explicitly leaves/publishes/discards.

Dan then asked for a broader review:

- Review the proposed/found fix and decide whether it was correct.
- Check whether the fix exposed other bugs or created new bugs.
- Investigate why AI generation sometimes did not create an image.
- Investigate why AI image generation took so long.
- Find ways to reduce AI deal/image generation time.
- Make a plan, then continue implementing from Phase 0 onward.
- Continue Phase 2 using the connected S10 loaded with a dev build.
- Later, after an accidental Publish tap, continue investigating the separate publish failure.

## Repo and environment context

- Repo path: `C:\Users\unvme\Downloads\twoforone`
- Branch during this handoff: `qa/poster-ad-quality`
- Branch state at handoff: ahead of origin by 19 commits; local working tree still dirty.
- Main connected Android device used for QA: Samsung S10, adb serial `RF8T20X0Z7P`.
- Package observed on the S10: `com.unvmex2.twoforone/.MainActivity`
- Observed installed app metadata:
  - `versionName=1.0.0`
  - `versionCode=55`
  - debuggable build
  - installed July 20, 2026
- The separate dev package `com.unvmex2.twoforone.dev` was not installed when checked, though Dan clarified the dev APK had been installed/running earlier in the session.
- The app instance used for S10 QA appeared to be pointed at production Supabase.
- Local artifacts were saved under `artifacts\s10-qa-20260721\`.

## Important guardrails followed

- No git commit was created.
- No push was performed.
- No release or production-like app build was started.
- No Supabase migration was applied.
- No `supabase db push` was run.
- No Supabase secrets were changed.
- No production Supabase deploy was performed except the explicitly approved AI Edge Function deploys listed below.
- `publish-offer-version` was not deployed.
- The accidental Publish tap did not result in a known successful live deal publish.
- The S10 QA draft was discarded after the accidental Publish failure.
- Secrets/passwords pasted by Dan were not copied into code, docs, terminal output, or this handoff.

## Approvals that mattered

Dan gave multiple approvals during the session, including:

- Approval for a named set of protected AI/poster files earlier in the flow.
- Approval for the Phase 1 file set: “I approve all 20 named Phase 1 files for the described changes.”
- Approval to continue into Phase 2.
- Approval to deploy the two AI generation Edge Functions to production when option `#1` was requested.
- Approval to use the business account for S10 QA.

At the stopping point, approval had not yet been given for the four proposed `publish-offer-version` hardening files:

- `lib/offer-version-publish.ts`
- `lib/offer-version-publish.test.ts`
- `supabase/functions/publish-offer-version/deno.json`
- `supabase/config.toml`

Those four files still need explicit approval before editing because they affect AI Create/versioned publish behavior and one of them is protected by the AI poster core lock.

## What was completed

### Phase 0: audit and diagnosis

Read-only audit was performed against the repo/source-of-truth docs required by `AGENTS.md`, including:

- `docs/release-audit/current-state.md`
- `docs/deployment-notes.md`
- `docs/production-deploy-checklist.md`
- `docs/deployment-command-plan.md`
- `docs/ai-ad-current-state.md`
- `docs/dev/AI_DEAL_STUDIO_DEV_APK_SETUP.md`
- `docs/dev/AI_DEAL_STUDIO_SUPABASE_DEV_SETUP.md`
- `docs/dev/AI_STUDIO_EDGE_FUNCTION_DEV_DEPLOY.md`
- `docs/beta-release-checklist.md`

Key constraints confirmed:

- AI poster/ad generation files are protected and require explicit file-level approval before changing.
- AI Studio dev publishing must stay disabled in dev builds.
- Supabase migrations and hosted Edge Function deploys are hard-gated.
- Production package id remains `com.unvmex2.twoforone`.
- Dev AI Studio variant uses `com.unvmex2.twoforone.dev`, but that package was not the one observed on the connected S10.

### Phase 1: AI poster editor/review fixes

Implemented local client-side work to make accepted AI/poster drafts editable without losing state or jumping back to Create.

Important behavior now covered locally:

- Accepted AI poster/review state is preserved while editing fields.
- Merchant edits invalidate stale approval hashes instead of silently publishing old approved copy.
- Re-approval works from the currently visible edited draft, not from stale AI output.
- Draft recovery includes the relevant AI/poster review state.
- Dirty-state detection accounts for generated/accepted ad state and poster edit state.
- Localization copy was added/updated for newly surfaced review/publish states.
- Source-contract tests were updated to pin the desired editor/publish behavior.
- AI poster lock metadata was updated for the approved protected-file edits.

Local files modified for this phase include:

- `app/create/ai.tsx`
- `lib/ai-deal-draft-recovery.ts`
- `lib/ai-deal-draft-recovery.test.ts`
- `lib/ai-deal-review-draft.ts`
- `lib/ai-deal-review-draft.test.ts`
- `lib/deal-form-dirty.ts`
- `lib/deal-form-dirty.test.ts`
- `lib/create-ai-ux-source.test.ts`
- `lib/i18n/locales/en.json`
- `lib/i18n/locales/es.json`
- `lib/i18n/locales/ko.json`
- `docs/ai-poster-core-lock.json`

Additional poster/presentation robustness work present in the dirty tree:

- `components/poster/AdPosterCanvas.tsx`
- `components/poster/__tests__/AdPosterCanvas.test.ts`
- `lib/poster/posterCopy.ts`
- `lib/poster/posterPolicy.ts`
- `lib/poster/__tests__/posterPolicy.test.ts`
- `lib/ad-spec.ts`
- `lib/ad-spec.test.ts`
- `lib/ad-presentation-hash.ts`
- `lib/ad-presentation-hash.test.ts`

Those changes support the poster/editor/publish safety model around live merchant-edited review snapshots, locale/presentation hashing, generic poster kicker policy, and poster rendering/source guards.

### Phase 2: AI image generation reliability and latency work

Implemented local Edge Function/shared-provider changes to make AI image generation more deadline-aware and easier to diagnose.

Important behavior added locally:

- A request-wide image deadline helper was added.
- Image provider calls now consider remaining request budget before starting/retrying expensive image attempts.
- Provider retry behavior is deadline-aware.
- Stage-level timing and sanitized telemetry were added so slow/no-image cases can be diagnosed without exposing upstream raw bodies or secrets.
- The AI Studio draft smoke script was updated to report useful image timing.
- The AI generation paths now have better odds of returning before hosted worker limits are hit.

Main files changed for this phase:

- `supabase/functions/_shared/ai-image-deadline.ts`
- `supabase/functions/_shared/ai-image-deadline.test.ts`
- `supabase/functions/_shared/ai-image-provider.ts`
- `supabase/functions/_shared/ai-image-provider.test.ts`
- `supabase/functions/_shared/dalle-image.ts`
- `supabase/functions/_shared/dalle-image.test.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/ai-studio-generate-draft/index.ts`
- `scripts/smoke-ai-studio-generate-draft.mjs`
- `supabase/functions/_shared/ai-generate-ad-variants-image-budget-source.test.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-ownership-source.test.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-telemetry-source.test.ts`
- `supabase/functions/_shared/ai-studio-generate-draft-source.test.ts`

### AI image/no-image investigation result

The strongest diagnosis from this session:

- Historic “no image” cases were most likely caused by time-budget exhaustion and expensive provider retry paths, not by the editor screen itself.
- The generation request has multiple costly stages: research, copy, image generation, QA/retry/fallback, localization, and final response shaping.
- When upstream image generation or a retry path consumed too much wall-clock time, the function could run out of useful budget before returning a generated image.
- The new Phase 2 changes do not make image generation instant, but they prevent wasting the last seconds of a request on attempts unlikely to finish and give clearer timing telemetry.

Production smoke timings after deployment showed:

- `ai-studio-generate-draft`
  - passed
  - Gemini image stage about 10.2s
  - copy stage about 5.1s
  - total image-deadline elapsed about 15.6s
- direct `ai-generate-ad-variants`
  - passed
  - wall-clock about 44.6s
  - research about 2.2s
  - copy about 7.7s
  - image about 24.3s
  - localization about 8.0s
  - two Gemini image attempts succeeded around 7.4s and 8.6s

Practical answer to “can we decrease AI deal generation time?” from this session:

- Yes, partially already done by enforcing a shared request image deadline and skipping doomed retries.
- Biggest remaining opportunities are product/architecture choices:
  - avoid multiple image attempts unless QA truly requires it;
  - stream/return copy first while image finishes in background;
  - cache business/menu/research context;
  - reduce or defer localization where possible;
  - add an instant deterministic/poster fallback when image generation misses budget;
  - make the first-use path less dependent on every AI stage completing synchronously.

### Edge Function deploys completed

Deployed to the Supabase development project:

- project ref `zsuzrerdailvylccqtds`
- `ai-studio-generate-draft`
- `ai-generate-ad-variants`

Deployed to production only after Dan approved the production deploy option:

- production project ref `kvodhiqhdqnptqovovia`
- `ai-studio-generate-draft` became ACTIVE version 34
- `ai-generate-ad-variants` became ACTIVE version 189

Notes:

- The first production deploy attempt for `ai-generate-ad-variants` hit a Supabase deploy-side `502` after upload and did not update the function.
- Retrying the deploy succeeded.
- No migrations were applied.
- No `publish-offer-version` deploy was performed.

## Validation completed

Earlier full validation passed after the Phase 1/2 local changes:

- `npm run typecheck:functions`
- `npm run gate:ai-poster-lock`
- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`

Known lint note:

- `npm run lint` had pre-existing duplicate import warnings in `app/business/[id].tsx`; those were not part of this task.

Focused validation completed during the publish-failure investigation:

- `deno check supabase/functions/publish-offer-version/index.ts`
- `npm test -- --run supabase/functions/_shared/publish-offer-version-function.test.ts lib/offer-version-publish.test.ts`
- `node scripts/probe-edge-functions-smoke.mjs publish-offer-version ai-studio-generate-draft ai-generate-ad-variants`
- Eight repeated safe no-auth smoke probes against `publish-offer-version`

Results:

- Local `publish-offer-version` Deno check passed.
- Focused publish tests passed: 22 tests across 2 files.
- Hosted no-auth smoke probes returned expected `401 Unauthorized` responses, meaning the functions booted and responded.

## S10 QA performed

### AI poster creation

On the connected S10:

- Started from a logged-in business account.
- Created a fresh AI poster deal using a BOGO latte offer.
- Android text injection left some `%20` artifacts in the initial description text, but the structured BOGO rule and eligibility were correct enough to generate.
- Schedule defaults were valid at the time:
  - one-time deal
  - start around July 21, 2026 9:56 PM America/Chicago
  - end around July 21, 2026 10:56 PM America/Chicago
- Tapped `Generate ad` around `2026-07-21T21:56:44-05:00`.
- Generation produced a real poster ad in roughly the first automation poll window.
- Poster content observed:
  - merchant: `The Colonel's Brew`
  - poster accessibility text included: `The Colonel's Brew poster. 2 FOR 1. SECOND LATTE ON US.`
- The generated image was present.

### AI poster editor field testing

After tapping `Use this ad`, the editor stayed on the `AI ads` screen and exposed poster/deal editable fields.

Fields tested on-device:

- Poster subheadline
  - typed `FRESH TODAY`
  - stayed in editor
  - artifact: `artifacts\s10-qa-20260721\after_subheadline_edit.xml`
- Poster headline
  - appended `QA`
  - field became `SECOND LATTE ON USQA`
  - preview accessibility text updated
  - artifact: `artifacts\s10-qa-20260721\after_poster_headline_edit.xml`
- Regular headline
  - appended `QA`
  - field became `Second latte on usQA`
  - artifact: `artifacts\s10-qa-20260721\after_edit_headline.xml`
- Regular subheadline
  - appended/inserted QA via Android input
  - text changed and stayed editable; cursor placement caused the inserted text to land mid-word
  - artifact: `artifacts\s10-qa-20260721\after_edit_subheadline.xml`
- Button text
  - typed QA after confirming focus
  - field became `ClaimQA deal`
  - artifact: `artifacts\s10-qa-20260721\after_edit_button_text_confirmed.xml`
- Offer details
  - typed QA after confirming focus
  - text changed; cursor placement caused insertion inside the address text
  - artifact: `artifacts\s10-qa-20260721\after_edit_offer_details_confirmed.xml`

Conclusion from this S10 pass:

- The original bug, “editing poster subheadline kicks back to Create Deal,” did not reproduce after the fixes.
- All visible editable text fields tested accepted edits.
- The screen stayed in the editor during those edits.
- Some awkward text results were due to Android automation cursor placement, not the app rejecting edits.

### Accidental Publish tap

During the offer-details test, the UI switched to `Publishing...`.

Dan later clarified he had tapped Publish by accident.

Observed result:

- Publish failed.
- Visible message included: `Couldn't publish this deal. Could not load bundle`
- No success message was observed.
- No dashboard redirect was observed from a successful publish.
- The QA draft was discarded afterward through the discard confirmation flow.
- The S10 was returned to the Create hub.
- Artifact after cleanup: `artifacts\s10-qa-20260721\after_cleanup_discard.xml`
- Current post-cleanup UI artifact: `artifacts\s10-qa-20260721\current_after_publish_failure.xml`

## Publish failure investigation

The accidental publish failure appears separate from the poster edit bug.

What was checked:

- `lib/offer-version-publish.ts` invokes `supabase.functions.invoke("publish-offer-version", ...)`.
- If the function call returns an error, the client tries to read the Edge Function response body; otherwise it falls back to the invoke error message.
- `app/create/ai.tsx` only calls `publishDeal()` from the Publish button path.
- The editable text fields do not directly publish.
- Push notifications are fire-and-forget after `publish-offer-version` succeeds, so the observed error was not a push-notification failure after a successful publish.
- The `publishDeal()` flow does not navigate to dashboard/success unless `publish-offer-version` returns `ok: true`.

Hosted function metadata checked:

- `publish-offer-version`
  - ACTIVE
  - version 54
  - `import_map=false`
  - older deployment timestamp than the two AI functions deployed during this session
- `ai-studio-generate-draft`
  - ACTIVE
  - version 34
  - `import_map=true`
- `ai-generate-ad-variants`
  - ACTIVE
  - version 189
  - `import_map=true`

Local source state checked:

- `supabase/functions/publish-offer-version/index.ts` imports shared function helpers and app-level `lib/*` modules, including poster validation.
- The local function does not currently have its own `deno.json`.
- `supabase/config.toml` currently does not wire an import map for `publish-offer-version`.
- Newer AI functions do have function-local `deno.json` files and are deployed with `import_map=true`.

Interpretation:

- The raw phrase `Could not load bundle` is an infrastructure/runtime-style failure phrase, not a friendly app-level publish validation message.
- The hosted function responded as healthy when probed after the fact, so the failure was not a persistent boot failure at the time of investigation.
- The failure may have been transient, cold-start/deployment/runtime related, or tied to the authenticated publish payload path.
- Because no authenticated publish repro was run after cleanup, the exact payload-specific cause is not proven.
- Regardless of the root cause, the app should not show raw `Could not load bundle` text to a merchant.

Proposed but not yet approved fix:

- Sanitize Edge runtime/bundle-load publish errors into a friendly retry/publish-unavailable message.
- Add regression coverage for that sanitization.
- Add `supabase/functions/publish-offer-version/deno.json`.
- Wire `publish-offer-version` to that config in `supabase/config.toml`.
- Validate locally.
- Only after separate approval, redeploy `publish-offer-version` and run a safe smoke check.

## Current dirty working tree at handoff

Tracked modified files:

- `app/create/ai.tsx`
- `components/poster/AdPosterCanvas.tsx`
- `components/poster/__tests__/AdPosterCanvas.test.ts`
- `docs/ai-ad-current-state.md`
- `docs/ai-poster-core-lock.json`
- `lib/ad-presentation-hash.test.ts`
- `lib/ad-presentation-hash.ts`
- `lib/ad-spec.test.ts`
- `lib/ad-spec.ts`
- `lib/ai-deal-draft-recovery.test.ts`
- `lib/ai-deal-draft-recovery.ts`
- `lib/create-ai-ux-source.test.ts`
- `lib/deal-form-dirty.test.ts`
- `lib/deal-form-dirty.ts`
- `lib/i18n/locales/en.json`
- `lib/i18n/locales/es.json`
- `lib/i18n/locales/ko.json`
- `lib/offer-version-publish.test.ts`
- `lib/poster/__tests__/posterPolicy.test.ts`
- `lib/poster/posterCopy.ts`
- `lib/poster/posterPolicy.ts`
- `scripts/smoke-ai-studio-generate-draft.mjs`
- `supabase/functions/_shared/ai-generate-ad-variants-image-budget-source.test.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-ownership-source.test.ts`
- `supabase/functions/_shared/ai-generate-ad-variants-telemetry-source.test.ts`
- `supabase/functions/_shared/ai-image-provider.test.ts`
- `supabase/functions/_shared/ai-image-provider.ts`
- `supabase/functions/_shared/ai-studio-generate-draft-source.test.ts`
- `supabase/functions/_shared/dalle-image.test.ts`
- `supabase/functions/_shared/dalle-image.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts`
- `supabase/functions/ai-studio-generate-draft/index.ts`

Untracked files:

- `docs/plans/first-deal-ai-quality-harness.md`
- `docs/plans/poster-ad-quality-harness.md`
- `lib/ai-deal-review-draft.test.ts`
- `lib/ai-deal-review-draft.ts`
- `supabase/functions/_shared/ai-image-deadline.test.ts`
- `supabase/functions/_shared/ai-image-deadline.ts`
- `docs/session-handoffs/2026-07-22-ai-deal-studio-s10-handoff.md`

Git diff stat before this handoff file was created:

- 32 files changed
- about 1,191 insertions
- about 288 deletions

This handoff file adds one more untracked markdown file.

## Still needs to be done

### RESOLVED 2026-07-22: publish hardening implemented

Dan approved the publish hardening on 2026-07-22 and it is implemented locally. The
approved scope differs from the proposal below, because two of the four proposed
files were shown to be a no-op:

- `supabase/functions/publish-offer-version/deno.json` and the `supabase/config.toml`
  import-map wiring were **rejected with evidence and not created**. The
  `import_map=false` correlation was a false lead: `publish-offer-version/index.ts`
  imports only full URLs (`deno.land/std`, `esm.sh/@supabase/supabase-js`) and
  relative `.ts` paths, with zero bare specifiers for an import map to resolve.
  66 of 79 functions have no `deno.json` at all, and 11 of the 13 that do contain
  only an empty `imports` object. Adding one would flip a cosmetic deploy-metadata
  flag and change nothing at runtime.
- Consequence: **no `publish-offer-version` deploy is needed.** That gate is closed,
  not pending.

The real defect was in the client. `publishErrorDetail()` in `app/create/ai.tsx`
ended with an unconditional raw passthrough, echoing any unmatched error message
verbatim after `"Couldn't publish this deal."`. `Could not load bundle` was one
instance; any Deno stack trace, driver error, or upstream text leaked the same way.

Implemented and validated:

- `lib/offer-version-publish.ts` - new exported `PUBLISH_SERVICE_UNAVAILABLE_CODE`
  and `isEdgeRuntimeFailureMessage()`. An Edge Runtime bundle/boot/worker failure
  arriving without a structured `error_code` is rethrown as a retryable outage
  instead of carrying the runtime's wording.
- `app/create/ai.tsx` (locked, approved) - maps that code and any matching raw
  message to new localized copy; `unauthorized` added to the permission branch; the
  raw passthrough is now gated behind `if (!code) return null;` so only errors our
  own function body produced are ever echoed.
- `lib/i18n/locales/{en,es,ko}.json` - new `createAi.errPublishServiceUnavailable`.
- `lib/offer-version-publish.test.ts` (locked, approved) - new "publish error
  surfacing" suite mocking `./supabase`.
- `lib/offer-version-publish-source.test.ts` - source contract pinning the closed
  passthrough.
- `lib/create-ai-ux-source.test.ts` (locked, approved) - repaired a pre-existing red
  test from the prior session: it asserted ai.tsx source with a hardcoded `\n`
  inside `toContain`, but git normalizes that file to CRLF on Windows checkouts, so
  it could never match. Swapped to a `\s+` regex pinning the identical contract.
- `docs/ai-poster-core-lock.json` - hashes and approval refs for all three locked
  files.

Validation run 2026-07-22, all green: `typecheck`, `typecheck:functions`, `lint`
(0 errors; the 2 pre-existing `app/business/[id].tsx` duplicate-import warnings
remain), `gate:ai-poster-lock` (30/30), `gate:ai-ad`, `copy:evaluate`, and
`npm test -- --run` at **1875 passed / 1875**.

Still outstanding: app rebuild + S10 re-QA (below). No commit, no push, no deploy.

<details>
<summary>Original proposal, superseded</summary>

Dan needs to approve or reject the proposed four-file publish hardening:

- `lib/offer-version-publish.ts`
  - Intended change: classify/sanitize Edge runtime bundle-load failures instead of surfacing raw `Could not load bundle`.
  - Validation impact: add/extend publish error tests.
  - Deploy impact: client/app rebuild needed for changed error mapping.
- `lib/offer-version-publish.test.ts`
  - Intended change: regression test for sanitized publish runtime errors.
  - Validation impact: test-only.
  - Deploy impact: none.
- `supabase/functions/publish-offer-version/deno.json`
  - Intended change: give `publish-offer-version` function-local Deno config like the newer AI functions.
  - Validation impact: Deno check and function source/package guard.
  - Deploy impact: requires Supabase Edge Function redeploy to affect hosted production.
- `supabase/config.toml`
  - Intended change: wire `publish-offer-version` to its Deno config/import map.
  - Validation impact: source/config guard.
  - Deploy impact: no hosted change until `publish-offer-version` is deployed.

Do not edit those until Dan explicitly approves them.

### After approval, implement the publish hardening

Recommended exact sequence:

1. Patch the four files above.
2. Run:
   - `deno check supabase/functions/publish-offer-version/index.ts`
   - `npm test -- --run lib/offer-version-publish.test.ts supabase/functions/_shared/publish-offer-version-function.test.ts`
   - `npm run typecheck:functions`
   - `npm run gate:ai-poster-lock`
   - `npm run typecheck`
   - `npm run lint`
   - focused/full `npm test -- --run` as risk dictates
3. Report results to Dan.
4. Ask separately before deploying `publish-offer-version`.

### If Dan approves deploying `publish-offer-version`

Only with explicit deploy approval:

1. Deploy `publish-offer-version` to the intended project.
2. Confirm function metadata shows ACTIVE and, ideally, `import_map=true`.
3. Run the safe no-auth smoke probe:
   - `node scripts/probe-edge-functions-smoke.mjs publish-offer-version`
4. If Dan wants a real authenticated publish QA, ask for explicit approval because that can create a live deal.
5. If a real QA publish is approved, use a clearly disposable test deal/business and document any created deal so it can be cleaned up safely.

</details>

### DONE 2026-07-22: S10 QA run against working-tree JS (no rebuild)

No rebuild was needed. The "dev APK" is the DEBUGGABLE build of `com.unvmex2.twoforone`
— the ai-studio-dev JS/config runs inside the production-package native shell, so
`pm list packages` never shows `com.unvmex2.twoforone.dev` and is the wrong way to check.
Use the app's own `[twoforone:boot]` logcat line instead. Recipe:
`adb reverse tcp:8081 tcp:8081` → `EXPO_NO_METRO_LAZY=1 npx expo start --dev-client` →
`adb shell am start -a android.intent.action.VIEW -d "twoforone://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`.
Boot log confirmed `gitCommit: 32d96d81`, `appVariant: ai-studio-dev`, and — confirming
the prior session's suspicion — `productionSupabaseHost: kvodhiqhdqnptqovovia`, i.e. this
dev build talks to PRODUCTION Supabase, contrary to CLAUDE.md.

PASSED:

- The original bug does NOT reproduce. Editing the poster subheadline kept the screen on
  `AI ads`, kept the field focused, and live-updated the counter (11/32 → 15/32).
- Preview equals publish inputs. Typing `FRESH TODAY NOW` and later `ALL DAY TUESDAY`
  rendered on the poster immediately.
- Draft recovery restored the full generated-ad + poster review state with every prior
  merchant edit intact, and correctly demanded re-approval
  ("The preview changed. Review the updated ad and approve it again before publishing.").
- 32d96d81 holds: Create hub → AI builder with no "Redirecting..." or login flash.
- Fresh generation took **≤33s vs the 44.6s baseline**. Single sample and image time
  varies run to run, so treat this as directionally consistent with the localization
  overlap, not as proof.
- Copy quality was good: headline `ONE LATTE, TWO CUPS` (not formulaic, passes R5/R6).

Publishing was NOT exercised — `aiStudioDevPublishingDisabled: true` on this variant, so
the publish-error sanitization remains covered by unit + source-contract tests only.

NEW ISSUES FOUND:

1. ~~**Draft recovery restores a stale end time.**~~ **FIXED 2026-07-22.** The recovered
   draft had its start advanced to now (Jul 21 11:33 PM) but its end restored from the
   prior session (Jul 21 10:56 PM) — 37 minutes BEFORE the start. The poster rendered
   `REDEEM BY JUL 21, 10:56 PM`, already in the past, and nothing in the UI flagged it.
   Root cause: `cleanDate()` in `lib/ai-deal-draft-recovery.ts` only proves a date
   *parses*; nothing anywhere enforced `end > start`, so any stale pair survived intact.
   `buildAiDealRecoveryDraft` now rebuilds the end from the start whenever the restored
   end does not follow it (inverted *or* zero-length). Non-locked file; 3 regression tests
   added covering inverted, equal, and valid windows.
2. **`docs/ai-poster-core-lock.json` R12 narrative is stale.** It claims the editable
   poster subheadline was removed and replaced by a test named "no longer offers a poster
   subheadline the renderer cannot show". Neither is in this tree: `posterSublineText`
   appears 18× in `app/create/ai.tsx`, the live test asserts the opposite ("keeps a manual
   poster subheadline live-editable"), and the field renders correctly on device. The real
   fix here is `lib/poster/posterCopy.ts:574` —
   `subline: locale === sourceLocale ? base.subline : undefined` — the renderer was fixed
   rather than the field deleted. Per CLAUDE.md, code wins; the lock text should be corrected.
3. ~~**`docs/dev/AI_STUDIO_EDGE_FUNCTION_DEV_DEPLOY.md` points at production.**~~
   **NOT A BUG — Dan's decision 2026-07-22: "keep it pointing to production."** The dev
   build using the production Supabase project (`kvodhiqhdqnptqovovia`) is deliberate for
   now, so the doc is consistent with the intended setup and was left unchanged. This does
   still diverge from CLAUDE.md's "dev builds must use a separate Supabase development
   project" rule — revisit if that rule is meant to bind.

## Dan's decisions, 2026-07-22

- **Reducing image generation attempts: "leave it alone for now."** This was the largest
  remaining latency win (image is 24.3s of 44.6s, two Gemini attempts at ~7.4s and ~8.6s)
  but it trades image quality for speed. Not pursued.
- **Dev build's Supabase target: "keep it pointing to production."** See above.
- **Commit and push: approved and done.** See the session-close section at the end.

### S10/app validation still needed

After the next app rebuild/install that includes the local client changes:

- Confirm which package is installed:
  - production package `com.unvmex2.twoforone`
  - or dev package `com.unvmex2.twoforone.dev`
- Confirm which Supabase project the installed app is pointed at.
- Repeat AI poster creation and editor QA:
  - Use AI poster style.
  - Tap `Use this ad`.
  - Edit poster headline/subheadline if still present.
  - Edit regular headline.
  - Edit regular subheadline/supporting copy.
  - Edit button text.
  - Edit offer details.
  - Scroll away/back.
  - Back out and resume recovery draft.
  - Re-approve preview after edits.
  - Confirm no stale AI copy overwrites merchant edits.
- If Dan explicitly approves a real publish test, verify publish succeeds or fails with friendly/actionable error copy.
- Specifically re-check the 2026-07-22 fix: a failed publish must now show either a
  mapped message or the bare "Couldn't publish this deal." banner. Seeing any raw
  server/runtime text appended to that banner means the passthrough gate regressed.

### AI generation latency still worth improving

**DONE 2026-07-22 - localization now overlaps the image chain.** Dan approved the one
locked file (`supabase/functions/ai-generate-ad-variants/index.ts`). The pipeline was
strictly sequential (research 2.2s -> copy 7.7s -> image 24.3s -> localization 8.0s =
44.6s), but localization reads offer facts and `copy` and never the generated image.
`offerDefinition.sourceAssetIds` was the only image-derived field in reach and is a pure
passthrough (`buildOfferDisclosureLine`'s `Pick<>` signature structurally cannot see it),
so the facts are final once copy is done. Localization is now started before
`produceImage` and awaited after, with a `.catch(() => {})` sink so an image-chain throw
cannot orphan it into an isolate-killing unhandled rejection, and the post-image
`offerDefinition` is a spread of the same facts rather than a second build. Expected
~8s off ~44.6s (~18%), which also buys headroom against the ~150s
`WORKER_RESOURCE_LIMIT` kill. Identical provider calls, output and spend. Ordering is
pinned by a new contract test. **Needs an `ai-generate-ad-variants` edge deploy to take
effect — not deployed.**

Remaining follow-ups, in the order I would take them:

- **Reduce image attempts** (biggest remaining: image is 24.3s of 44.6s, and the measured
  run made two Gemini attempts at ~7.4s and ~8.6s). This trades image quality for speed,
  so it is a product decision for Dan, not a safe unilateral optimization.
- The rest below are unchanged from the original list:

- Add a background/async image completion mode so copy/review can appear before final image completion.
- Add a deterministic instant poster/image fallback for when image budget is exhausted.
- Consider reducing maximum image attempts for first-deal flow.
- Cache merchant/research context per business/menu item.
- Defer localization until after merchant accepts the draft, or make it async, if product rules allow.
- Add production dashboards around:
  - total generation wall-clock
  - copy stage duration
  - image stage duration
  - provider selected
  - retry count
  - fallback reason
  - no-image reason
  - deadline/remaining-budget reason
- Continue comparing production `ai_generation_costs`/telemetry before and after the deployed Phase 2 functions.

### Security cleanup still needed outside Codex

Dan pasted sensitive values during this session. They are deliberately not recorded here.

Recommended cleanup:

- Rotate the pasted Supabase secret tokens.
- Change the pasted business-account password if that account is not disposable.
- Avoid pasting raw secrets/passwords into chat going forward; use environment variables or a secret manager flow when possible.

### Repo cleanup still needed

Before merging or handing off:

- Re-run the full validation suite.
- Decide whether all untracked plan/harness files should be kept.
- Update docs/lock metadata only where required by approved protected-file changes.
- Review the dirty tree carefully so unrelated artifacts are not committed.
- Commit locally only if Dan asks for a commit.
- Do not push unless Dan explicitly asks for a push.

## Bottom-line status

- The original S10 poster edit/navigation bug appears fixed based on on-device QA.
- AI image generation now has local and deployed improvements for deadline-aware retries and timing telemetry.
- The two AI generation Edge Functions were deployed to both dev and production after approval.
- The accidental Publish failure remains unresolved as a separate issue; it could not be reproduced with safe no-auth probes, but it exposed that raw infrastructure errors can reach merchant-facing UI.
- Next decision required from Dan: approve or reject the four-file `publish-offer-version` hardening package.

---

## RESOLVED 2026-07-22 (second Claude session) — publishing an AI poster ad

**Fixed, and verified live on the S10: a real AI poster deal published successfully.**
The root cause below was found by static analysis plus a runnable repro, so the proposed
instrumentation edit and device-repro cycle were never needed. See
"Publish unblocked" at the end of this file for the diagnosis, the fix, and the device run.
Everything from here to that section is the *pre-fix* investigation, kept for the record —
including two conclusions that turned out to be wrong.

## HIGH (HISTORICAL) — publishing an AI poster ad is blocked on this branch

Found 2026-07-22 during the approved publish QA on the S10. **Reproduced twice.**

Symptom: tapping **Publish deal** fails with
`Publish failed — "Approve the exact ad preview again before publishing."`
No deal is created: the guard returns before `publish-offer-version` is ever invoked, so
nothing reached the server and there is nothing to clean up.

> **Correction (2026-07-22 second review): only ONE of the two observed blocks is a bug.**
> Run 1 (the recovered draft) blocking was **designed behavior**: recovery deliberately
> nulls approval hashes (they are session-only), the "Approve your changes" panel *was*
> on screen (visible in the first run-1 UI dump at y≈1884/2182), and publish was tapped
> without re-approving. That block is the system working. The earlier claim of
> "reproduced twice" overstated the evidence. The genuine anomaly is **run 2**: fresh
> generate → "Use this ad" → publish ~60s later with zero edits in between — that should
> never block, and it did.

### Root cause — CORRECTED

> **An earlier version of this section (commit `ca91e728`) blamed the hash comparison at
> `ai.tsx:3994`. That was wrong: that guard never runs, because an earlier one returns
> first.** The analysis below supersedes it. Kept visible rather than silently rewritten,
> because the wrong version was already pushed.

The guard that actually fires is `app/create/ai.tsx:3656`:

```js
if (!editingDealId && generatedAd && composedExactPresentationApprovalEnabled) {
  if (!adAccepted || !composedPresentationApprovalMatches) { /* blocked */ }
```

`composedPresentationApprovalMatches` (`ai.tsx:4647`) requires all four of:

1. `approvedComposedPresentationHash === selectedComposedPresentationHash`
2. `selectedComposedCompositeQa.decision !== "block"`
3. `selectedComposedCompositeQa.decision !== "unavailable"`
4. `!selectedComposedScreenshotQaRequired`

Eliminating each against the observed run:

- **`adAccepted`** is true — `acceptAd` sets it at `ai.tsx:3422`, and the UI did transition
  into the editor, so accept completed.
- **(4)** must be false — `acceptAd` returns early with
  "This ad needs visual review before it can be approved" when screenshot QA is required,
  and that did not happen.
- **(2)** must be false — `acceptAd` returns early on a `"block"` decision too.
- **(3)** is a dead branch — `"unavailable"` appears only in the `AdCompositeQaDecision`
  union; `runDeterministicAdCompositeQa` never produces it.

**Therefore (1) is false: `approvedComposedPresentationHash !== selectedComposedPresentationHash`.**
Both sides of that comparison are the *preview* hash. `acceptAd` sets the approved one from
`selectedComposedPresentationHash` at `ai.tsx:3414`, so they are equal by construction at
that instant. The only way they can differ at publish time is that
**`selectedComposedPresentationHash` drifts after `acceptAd` runs** — the approval is stale
the moment it is granted.

#### Verification pass (2026-07-22, second review): mechanisms eliminated one by one

A follow-up static audit checked every candidate mechanism. The earlier guess that
"`acceptAd` flips state that feeds the hash" is **disproven** — `adAccepted` and
`manualDraftUnlocked` feed no hash input (`livePosterPreviewSpec` at `ai.tsx:4455` is gated
on `showPosterFormat && offerDefinition` only, both stable across accept). All eliminations,
each verified in source:

| # | Mechanism | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `"unavailable"` QA decision blocks publish | **Dead** | `runDeterministicAdCompositeQa` returns only `pass`/`repair`/`block` (`ad-composite-qa.ts:166`). The `decision: "unavailable"` at `ai.tsx:690` is a different type (`AdImageSelectionQa`), never flows into `selectedComposedCompositeQa` (`ai.tsx:4603`). |
| 2 | Screenshot-QA requirement | **Dead** | `EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED` is unset in this dev env → `selectedComposedScreenshotQaRequired` is always false. |
| 3 | `acceptAd` stamped `null` (flag mismatch) | **Dead** | `shouldBindComposedPresentationApproval` (`ai.tsx:4644`) = `composedAdPreviewEnabled ∥ …`; `composedAdPreviewEnabled` (`ai.tsx:4487`) is an OR of three V4 flags, all `true` on-device per the boot log. A real hash was stamped. |
| 4 | Fields seeded *at accept* (hash drifts on seed) | **Dead** | `applyAdToDraft` runs at generation-complete (`ai.tsx:3085`) and revision-complete (`:3294`), never inside `acceptAd`. Fields were already seeded before the accept tap. |
| 5 | Accept-state feeds the hash | **Dead** | Traced every hash input; none reads `adAccepted`/`manualDraftUnlocked`. |
| 6 | Volatile field in the hashed spec (minted id/timestamp) | **Dead** | `createAdPresentationHash` hashes a fixed *projection* (imageAssetId, crop, focalPoint, templateId, themeId, flags, copy lines, offer lines, versions, localeOverrides, reviewContext) — no ids, no dates. `buildDefaultAdPresentationSpec` mints nothing volatile. |
| 7 | Async signed-URL flip (`adImageUri`) | **Dead** | `adImageUri` (`ai.tsx:4445`) is `buildPublicDealPhotoUrl(currentAdStoragePath)` — synchronous public URL, no token refresh. |
| 8 | Clock-derived offer facts (hash drifts per minute) | **Dead as traced** | `displayScheduleSummary` is `useMemo` on schedule state; `buildOwnerLanguagePreview` takes only state. No `Date.now()` found in any hash input path. |
| 9 | A focus/blur handler nulls the approval | **Dead** | Zero `onFocus` handlers in `ai.tsx`. Of the 11 `setApprovedComposedPresentationHash(null)` sites, none can run between accept and the guard without user action (they live in restore/regenerate/revise/format-switch/edit paths). |
| 10 | Accept never completed in run 2 | **Dead** | `startGeneration` resets `adAccepted(false)` (`~ai.tsx:2480`), the review CTA ("Use this ad") renders in that state, and it *disappeared* from every post-tap dump — `acceptAd` reached `setAdAccepted(true)` (`:3422`), which sits *after* the approval stamp (`:3414`). |

**What survives:** some hash input is a pure function of React state that changed between
the accept render and the publish render with no user edits — and every traced input claims
to be stable. Static analysis cannot close that gap; the model is missing something the
runtime will show immediately.

**Decisive next step (small, needs Dan's per-file approval on `app/create/ai.tsx`):**
temporarily log `stablePresentationJson(payload)` — the exact pre-hash string from
`lib/ad-presentation-hash.ts` — at accept-time and at guard-time, reproduce one blocked
publish via Metro, and diff the two strings. The changed field names the bug. The existing
`COMPOSED_PUBLISH_BLOCKED` telemetry (`ai.tsx:3658`) already carries both hashes and will
confirm inequality, but only the payload diff identifies *which* field moved.

### Earlier (superseded) hypothesis, kept for the record

The preview and publish sites do build their review contexts from different inputs, and
this is still worth tidying even though it is not what blocked publishing here: the hashes
at `ai.tsx:4588` and `ai.tsx:3979` come from `buildLiveAdPresentationReviewContext(...)`
called with:

| input | preview / approve (`ai.tsx:4588`) | publish (`ai.tsx:3979`) |
| --- | --- | --- |
| `sourceLocale` | `effectiveDraftSourceLocale` | `supportedSourceLocaleForPublish` |
| `poster` | `effectivePosterSpec` | `posterForPublishSpec` |

`title`, `promoLine`, `ctaText` and `description` are the same live state on both sides, so
they are not the divergence. The two candidates are:

1. **The poster spec.** `effectivePosterSpec` (`ai.tsx:4470`) is
   `livePosterPreviewSpec ?? generatedAd?.poster ?? null` — so when `livePosterPreviewSpec`
   is null the preview hashes **the server-generated poster spec**. `posterForPublishSpec`
   (`ai.tsx:3906`) *always* rebuilds locally via `buildPosterSpecFromOfferDefinition`.
   `AdPresentationReviewContext` projects only `templateId`, `headline`, `subline`,
   `offerLine1`, `offerLine2` — so asset-path differences are ruled out, but a server-built
   vs locally-rebuilt `headline`/`offerLine1`/`offerLine2` can easily differ. This is the
   likeliest culprit.
2. **The source locale.** Two different variables, and
   `lib/create-ai-ux-source.test.ts` *pins both spellings*
   (`toContain("sourceLocale: effectiveDraftSourceLocale")` and
   `toContain("sourceLocale: supportedSourceLocaleForPublish")`), so the asymmetry is
   locked in by a test rather than flagged by one.

### Why it is likely new

`lib/ad-presentation-hash.ts` gained `reviewContext` in the prior session's batch (see
`git diff 32d96d81 b42ae69a -- lib/ad-presentation-hash.ts`). Folding the live editable
fields into the hash is the right safety model — preview must equal publish — but it makes
the hash sensitive to *any* approve-vs-publish input difference, and two such differences
were already present. Before that change the hash ignored these fields, so the mismatch
was invisible.

### Not fixed here, deliberately

This is core AI-create review/publish behaviour in a locked file. A careless fix (for
example relaxing the guard) would let unapproved creative publish — exactly what the lock
exists to prevent — and it cannot be validated without further device cycles. Dan's
blanket "approve anything" was not treated as sufficient for this per CLAUDE.md.

Suggested direction for whoever picks it up:

1. Read `presentation_hash` vs `approved_presentation_hash` from the
   `COMPOSED_PUBLISH_BLOCKED` telemetry on a real blocked publish. That names the drift
   immediately.
2. Find which input to `selectedPresentationReviewContext` changes across the `acceptAd`
   transition — `adAccepted` and `manualDraftUnlocked` are the two state flips `acceptAd`
   makes, so trace whatever they feed into `showPosterFormat` / `livePosterPreviewSpec` /
   `effectivePosterSpec`.
3. Fix by making the hash independent of accept-state, **not** by relaxing the guard.
4. Add a regression test asserting the hash is stable across accept for an otherwise
   unmodified draft — that is the invariant with no coverage today.

### Second, lower-severity finding: approval dead end — NARROWED on second review

The original claim ("recovered drafts land in a state with no approve control") was partly
wrong: when a recovered draft has `adAccepted === true` (the ad was accepted before the
draft was saved), `acceptedDraftRequiresReapproval` is true and the **"Approve changes"
panel does render** — run 1's own UI dumps show it. The genuine dead end is narrower:

- **`generatedAd && !adAccepted` after recovery** (the merchant generated but never tapped
  "Use this ad" before leaving). The publish guard (`ai.tsx:3656`) blocks on `!adAccepted`,
  the approve panel (`ai.tsx:6100` via `:4658`) requires `adAccepted` so it does not render,
  and whether the review section's "Use this ad" CTA is reachable in the recovered layout is
  unverified. If it is not, "Start over" is the only escape.

Worth closing, but it is an edge state, not the mainline blocker.

---

## Session close, 2026-07-22 (Claude)

### Shipped

- **Publish error sanitization.** `publishErrorDetail()` no longer echoes unrecognized
  server text to merchants; the raw passthrough is gated behind a structured `error_code`,
  and Edge Runtime boot/bundle failures map to new localized copy. The handoff's proposed
  `deno.json` + `config.toml` items were rejected with evidence as no-ops, which also
  removed the `publish-offer-version` deploy from the critical path entirely.
- **Generation latency.** Localization now runs concurrently with the image chain instead
  of after it. **DEPLOYED to production**: `ai-generate-ad-variants` ACTIVE **v190**
  (from 189), smoke probe `HEALTHY`. A live S10 generation ran in **≤33s vs the 44.6s
  baseline** (single sample; image time varies, so directional not conclusive).
- **Draft recovery end-time fix** (see New Issues #1 above).
- **Repaired a pre-existing red test** the prior session left behind: it asserted ai.tsx
  source with a hardcoded `\n` inside `toContain`, but git normalizes that file to CRLF on
  Windows checkouts, so it could never match. The prior handoff's claim that
  `npm test -- --run` passed did not hold on checkout.

### Final validation — all green

`typecheck` · `typecheck:functions` · `deno check` · `lint` (0 errors; the 2 pre-existing
`app/business/[id].tsx` duplicate-import warnings remain) · `gate:ai-poster-lock` 30/30 ·
`gate:ai-ad` · `copy:evaluate` · **`npm test -- --run` 1879/1879**

### Still open

- **Lock-file drift (New Issues #2).** `docs/ai-poster-core-lock.json`'s R12 narrative
  describes a poster-subheadline removal that is not in this tree. Correcting it means
  editing the lock file itself, which needs Dan's explicit per-file approval — deliberately
  not done unattended. The code is correct; only the narrative is wrong.
- **Publish-path device QA — RUN 2026-07-22, Dan approved publishing.** Publishing is in
  fact reachable on this build (`EXPO_PUBLIC_QA_ALLOW_PROD_SUPABASE_DEV_PUBLISHING`), so the
  earlier "not possible" note was wrong. The run surfaced the HIGH publish-blocking bug
  documented above. It also **validated the error sanitization end-to-end**: the failure
  rendered as the friendly localized `errPresentationApprovalRequired` copy, not raw server
  text, which confirms the new `if (!code) return null;` gate does not swallow legitimate
  coded errors. A genuine success-path publish is still unverified, because the hash bug
  blocks it.
- **Remaining latency ideas**, all deferred: async/background image completion, instant
  deterministic fallback when image budget is exhausted, per-business research/menu context
  caching, deferring localization until after merchant acceptance, and production
  dashboards over the `stage_timings_ms` / `image_pipeline_budget` telemetry.
- **Security cleanup outside the repo** (unchanged from the original handoff): rotate the
  Supabase tokens and the business-account password pasted in the earlier session.

---

## UPDATED PLAN (2026-07-22, after full verification pass)

A second review re-verified every claim in this handoff against source. Two earlier
findings were corrected (run-1 block = designed behavior; the approval dead end is narrower
than claimed), ten candidate mechanisms for the publish block were eliminated with
line-level evidence (table above), and one new edge case was found. Everything shipped
remains green: commits `b42ae69a` (code, validated 1879/1879 + all gates) and
`ca91e728`/`677dec75` (verified doc-only, so the validated code state is untouched).
`ai-generate-ad-variants` v190 remains ACTIVE in production.

### Verified-done (no action)

| Item | Proof |
| --- | --- |
| Publish error sanitization (client) | Code in `b42ae69a`; device-validated: blocked publish rendered localized copy, not raw text |
| Localization ∥ image chain | Deployed prod v190, smoke `HEALTHY`; live generation ≤33s vs 44.6s baseline (single sample) |
| Draft-recovery end-time fix | 3 regression tests green; guards inverted *and* zero-length windows |
| CRLF red-test repair | Suite 1879/1879 |
| Poster subheadline renders (R12 fear) | On-device screenshots: merchant-typed subline on poster in source locale |
| Editor QA / redirect fix / draft recovery | All exercised on-device via Metro, current-tree JS confirmed by boot log `gitCommit` |

### P0 — Unblock poster publishing (blocked pending Dan)

1. **Approve a temporary instrumentation edit to `app/create/ai.tsx`** (locked): log
   `stablePresentationJson(payload)` at accept-time and inside the `ai.tsx:3656` guard.
2. Repro once via Metro (recipe in this doc; `adb reverse` + dev-client deep link), diff
   the two payload strings → the drifting field is named. All cheap theories are already
   eliminated (see table), so the diff will be immediately meaningful.
3. Fix so the approved binding survives — by making the drifting input render-stable or by
   re-binding approval when it settles. **Never by relaxing the guard.**
4. Add the missing invariant test: the presentation hash is identical across the accept
   transition for an unmodified draft.
5. Device-verify: generate → accept → publish **succeeds**; confirm the deal goes live;
   then clean up the test deal (Dan approved real publishes; app is in testing).
6. Then close the narrowed dead end: recovered draft with `generatedAd && !adAccepted`
   must always render an accept path.

### P1 — Persistence and hygiene

7. **Rebuild + install the dev APK** (needs Dan: build gate). The S10's embedded bundle is
   still Jul 20 / commit-32d96d81-era; every fix QA'd this session was served by Metro and
   evaporates on the next cold start without it.
8. **Correct the lock file's R12 narrative** (needs Dan: lock-file approval). Code is
   right; the lock's story describes a removal that never shipped.
9. On-device cleanup when convenient: an accepted QA draft ("Your next latte stop") sits
   in recovery; 2 AI generations were consumed this session.

### P2 — Real but small

10. **Window inversion at publish (verified in source, new):** the `endTime <= startTime`
    validation (`ai.tsx:2654`) runs against raw state, but the past-start clamp
    (`ai.tsx:3748`) runs later — publishing after the end time produces an inverted
    window server-side unless the edge function catches it. Verify server behavior, then
    move the validation after the clamp (or clamp both).
11. Preview-vs-publish review-context input asymmetry (`effectiveDraftSourceLocale` /
    `effectivePosterSpec` vs `supportedSourceLocaleForPublish` / `posterForPublishSpec`):
    unify inputs; update the source-contract test that currently pins both spellings.
12. 401-with-no-code maps to `errPublishPermission` ("Log in with the owner account…");
    `friendlySession` ("Session expired…") is the better fit for expiry. One-branch polish.

### P3 — Standing items

13. Latency follow-ups (deferred set above; image-attempt reduction stays "leave alone" per Dan).
14. Rotate the previously pasted Supabase tokens + business-account password (outside repo).
15. Dev build intentionally points at production Supabase (Dan 2026-07-22); revisit only if
    the CLAUDE.md separate-dev-project rule is meant to bind again.

---

## Publish unblocked, 2026-07-22 (second Claude session)

### What was actually wrong

The prior session's corrected diagnosis named the wrong guard. `app/create/ai.tsx:3656`
**passes** — `selectedComposedPresentationHash` never drifts, which is exactly why all ten
candidate mechanisms came back dead. Execution reaches the *second* guard,
`app/create/ai.tsx:3994`, which compares the approved **preview** hash against a freshly
rebuilt **publish** hash. Those two were built with different localization gating:

| | approve/preview | publish |
| --- | --- | --- |
| locale-override resolution | `ownerLanguagePreviewAvailable && isAiV5LocalePresentationOverridesEnabled()` — requires the owner-UI flag | `localizationBundleForPublish && isAiV5LocalePresentationOverridesEnabled()` — bundle only |
| `localizedPreviewEnabled` | `ownerLanguagePreviewAvailable` | `Boolean(localizationBundleForPublish)` |
| locale screenshot QA | `ownerLanguagePreviewAvailable && …` | `localizationBundleForPublish && …` |
| source locale | `effectiveDraftSourceLocale` | `supportedSourceLocaleForPublish` |

`buildAiDealReviewDraft` always synthesizes a deterministic localization bundle, so
`localizationBundleForPublish` is never null. With `AI_V5_LOCALIZED_OWNER_UI` **off**, the
publish side therefore resolved `ko-KR` locale overrides that the approved preview never
had, and `createAdPresentationHash` folds `presentation.localeOverrides` into its payload
whenever the key is present (`lib/ad-presentation-hash.ts:82`). The two hashes could never
be equal, so every publish was rejected with zero merchant edits.

Reproduced deterministically against the real library functions before any code changed:

```
preview localeOverrides: undefined
publish localeOverrides: {"ko-KR":{...,"HANGUL_FONT_METRICS_GUARD"}}
previewHash adp_d1afde0fe133db49   publishHash adp_df202b21438e473c
```

### Corrections to the earlier write-up

1. **Not caused by `reviewContext`.** `localeOverrides` has been in the hash since
   `0b23fb3d`, and the publish-side gating asymmetry already existed at `32d96d81`. The
   defect is **pre-existing**; it had simply never been exercised, because AI-poster
   publishing was believed unreachable on the dev build.
2. **Production was never affected.** The block needs `LOCALIZED_OWNER_UI` off **and**
   `LOCALE_PRESENTATION_OVERRIDES` on **and** `EXACT_PRESENTATION_APPROVAL` on. Only
   `.env.development.local` has that combination — confirmed on-device in the
   `[twoforone:boot]` log. Every `eas.json` profile is safe: production sets
   `ownerUI=true` (so both sides agree) and leaves `exactApproval` unset (so the guard does
   not run). Severity was "publishing is blocked", actually "publishing is blocked on the
   local dev/Metro config".
3. The "approval dead end" and the ten-mechanism table remain accurate; they were just
   auditing the wrong guard.

### Fix (Dan approved each locked file individually)

- `app/create/ai.tsx` (locked) — the three publish gates now carry the missing
  `localizedOwnerUiEnabled` conjunct, matching their preview twins; a new component-scope
  `publishSourceLocale` is the single source locale both sides build from
  (`supportedSourceLocaleForPublish` reads it, and the approve-side poster spec, review
  draft, owner-language preview and review context read it instead of
  `effectiveDraftSourceLocale`). The appLanguage round-trip is identity for en-US/es-US/
  ko-KR, so wherever the owner-UI flag is on — every profile that sets it, production
  included — all four changes are a strict no-op. **The approval guard itself is unchanged
  and was deliberately not relaxed.**
- `lib/ai-publish-presentation-parity.test.ts` (new) — the invariant with no coverage
  before: approve-time and publish-time hashes are identical for an unedited accepted
  draft, across all three locales and both flag settings, plus a live demonstration that
  the pre-fix publish gate diverges, plus source contracts pinning all four gates.
- `lib/create-ai-ux-source.test.ts` (locked) — line 69 asserted the source still contained
  `sourceLocale: effectiveDraftSourceLocale`, i.e. it pinned the bug in place. Now pins
  `publishSourceLocale`.
- `docs/ai-poster-core-lock.json` (locked) — hashes and approval refs for both locked files.

Validation, all green: `typecheck`, `typecheck:functions`, `lint` (0 errors; the 2
pre-existing `app/business/[id].tsx` duplicate-import warnings remain),
`gate:ai-poster-lock` 30/30, `gate:ai-ad`, `copy:evaluate`, `npm test -- --run`
**1896/1896** (was 1879; +17 new parity tests).

### Device verification (S10 `RF8T20X0Z7P`, working-tree JS over Metro)

Boot log confirmed the diagnosed combination on the device itself:
`AI_V5_LOCALIZED_OWNER_UI (unset)`, `AI_V5_LOCALE_PRESENTATION_OVERRIDES true`,
`AI_V4_EXACT_PRESENTATION_APPROVAL true`, `productionSupabaseHost kvodhiqhdqnptqovovia`.

Run: Create hub → AI ads (no "Redirecting…"/login flash) → **Continue draft** on the
leftover QA draft (so no AI generation was spent) → re-approve → fix the schedule →
re-approve → **Publish deal**.

- **Publish succeeded.** "We're making your deal live" → Offers dashboard, *"Your next
  latte stop is now live for customers"*, 1 live deal, `Buy one latte and get one free`,
  Jul 22 9:43 AM → 1:00 PM. The approval error never appeared.
- Re-approval behaved correctly at both invalidation points (recovery, then the schedule
  edit): the "Approve your changes" panel appeared, and publishing was allowed only after
  approving.
- Evidence: `artifacts/s10-qa-20260722/publish-success.png`.
- **Cleanup done** — deal ended early, 0 claims, dashboard back to "No live deals".

### New issue found during this run (NOT fixed)

**Recovered drafts can still carry an inverted window.** The recovered draft opened with
**start Jul 22 9:28 AM** (advanced to now) and **end Jul 22 1:00 AM** — 8.5 hours before
the start — and the poster rendered `REDEEM BY JUL 22, 1:00 AM`. Nothing in the UI flagged
it; publish would have been rejected by the `endTime <= Date.now()` guard
(`app/create/ai.tsx:3644`) with a message about the end time, not about recovery.

Last session's `buildAiDealRecoveryDraft` fix rebuilds the end when the *restored* end does
not follow the *restored* start, so this is an ordering gap rather than a regression: the
start is advanced to "now" independently of the end-vs-start repair, so a pair that was
valid at save time becomes inverted at restore time. This is the same family as P2 #10
(the past-start clamp at `:3748` running after the validation at `:2654`). Fixing it means
re-running the end-follows-start repair *after* the start is clamped, in both the recovery
path and the publish path.

### Status of the rest of the plan

- **P0 1-5 — done.** Root cause found without the instrumentation edit, fixed, invariant
  test added, publish device-verified, test deal cleaned up.
- **P0 6** (recovered draft with `generatedAd && !adAccepted` must always render an accept
  path) — still open, untouched.
- **P1 7** (rebuild + install the dev APK) — still open; needs Dan's build approval. Every
  fix QA'd in these two sessions is still Metro-served.
- **P1 8** (lock-file R12 narrative) — still open.
- **P2 10** (window inversion at publish) — reinforced by the new finding above.
- **P2 11** (preview-vs-publish review-context asymmetry) — **done**, that was the bug.
- **P2 12**, **P3 13-15** — unchanged.

No commit, no push, no deploy, no migration, no build. Working tree carries
`app/create/ai.tsx`, `docs/ai-poster-core-lock.json`, `lib/create-ai-ux-source.test.ts`
and the new `lib/ai-publish-presentation-parity.test.ts`.

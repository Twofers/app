# AI Ads publish unblock plan (parser corruption + image blockers)

Status: PARTIALLY IMPLEMENTED 2026-07-10 (Dan chat approval "you have permission to do all the
others"). Written 2026-07-10 after a full on-device diagnosis (business dev APK
`com.unvmex2.twoforone.dev`, physical S10, Android 12).

## Implementation status (2026-07-10) — UNCOMMITTED, needs dev rebuild

Gates all green: `npm run typecheck`, `npm run lint`, `npm test` (1476), `node
scripts/check-ai-poster-core-lock.mjs` (30/30, `app/create/ai.tsx` hash re-locked with the
2026-07-10 approval ref).

- **Phase 1 — DONE.** 3 regression fixtures in `lib/deal-eligibility-inference.test.ts` (fail-first
  verified; one reproduced the `"B"` single-letter corruption).
- **Phase 2 (parser, items 1–3) — DONE** in `lib/deal-eligibility-inference.ts` (unlocked): spaced
  `"2 for 1"` → BOGO same-item; same reward noun stays `BUY_ONE_GET_ONE_FREE` (gated so the F-025
  `"second muffin"` case is untouched); percent-off + plain-item branches guard `isUsableItem`
  (kills the `"2"`/`"o"`/`"B"` single-letter leaks).
- **Phase 2.4 — DONE.** Enforcement added to `mergeInferredEligibilityForm` (`touchedFields`
  option + 2 tests); call-site `eligibilityTouchedRef` wired in `app/create/ai.tsx` so hint
  auto-inference never overwrites a hand-edited offer field or flips a manually chosen rule.
- **Phase 3 — DONE.** `friendlyGenerationError` routes a photo/image failure with NO attached photo
  to new `createAi.errImageServiceDown`; `offerMechanicsInvalid` reworded to point at the offer
  fields, not the ad copy. en/es/ko added to base locale files.
- **Phase 4 — DONE (code).** Root cause CONFIRMED: `expo-image-picker`'s own manifest declares
  `READ_EXTERNAL_STORAGE` but `app.json` `blockedPermissions` stripped it → picker dead on Android
  ≤12 (S10 is 12); 13+ works permission-free. Fix: removed `READ_EXTERNAL_STORAGE` from
  `blockedPermissions` (kept `WRITE_EXTERNAL_STORAGE` blocked); added a `console.warn` diagnostic in
  the picker catch. Optional Play-cleanliness follow-up: constrain it to `maxSdkVersion=32` via a
  config plugin (needs a build to verify the merged manifest). **Needs dev rebuild to take effect.**
- **Phase 0 (OpenAI credits) — WITHDRAWN.** Dan confirms credits were never exhausted. The instant
  no-image failure is NOT billing: in `ai-generate-ad-variants/index.ts` `produceImage` returns a
  null `posterStoragePath` when the vision QA step is unavailable or reports the required item
  missing (index.ts:2444), or when image bytes come back null (index.ts:2334) — client then shows
  `errImageGenerationNoImage`, no monthly use counted (matches "<3s, stays 24/30"). Confirming the
  exact failure needs the prod `ai_generation_costs`/logs rows for the failed request group.
- **Phase 5 — DONE (Dan approved "Phase 5 + Phase 6"); rule-compliant, NOT a rasterizer.** Earlier
  "gray box" reading was the LEGACY card (`components/deal-card-poster.tsx`). The live consumer feed
  uses `ComposedAdCard` (`EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED="true"` in prod) which renders a
  no-image deal NATIVELY (`deterministic_fallback`, offer text rendered live — no baked-in pixels,
  no gray box), and the deal row already stores `poster_url`/`poster_storage_path` as null. A
  rasterizer would have BAKED the offer text into pixels, violating the repo AI rule — avoided.
  Change: softened the two poster-style "Every deal needs an image" gates (`useFallbackTemplateAd`
  and `publishDeal`, gated on `showPosterFormat`) and guarded `usePhotoAsFinal` so a poster-only deal
  doesn't claim a nonexistent photo. Fail-safe: server rejection routes to existing publish-error
  handling, and the existing poster-spec→Standard-card fallback still applies. Standard-card format
  still requires an image. **Needs on-device verify: (a) `publish-offer-version` accepts an imageless
  deterministic ad_spec, (b) the `ComposedAdCard` fallback render is screenshot-worthy** (it may show
  a "Photo coming soon" visual rather than the owner's gradient poster — Phase 4 photo or a working
  AI image still give the nicest screenshot).
- **Phase 6 — DONE (likely fix; needs on-device confirmation).** The plan's "Edit offer details"
  (`description`) field was already safe (`invalidateAcceptedAdDraft`, keeps the image). The actual
  match for the symptom is the custom-image-edit **instruction** TextInput (`app/create/ai.tsx:4841`):
  its onChange called `resetGenerationState()` on EVERY keystroke, nulling `generatedAd` →
  collapsing the review UI to Step 1 mid-type → the field left holding one character. Fixed to call
  `invalidateAcceptedAdDraft()` (keeps the image; the instruction is applied on the next Generate),
  matching the copy fields. On repro, confirm this was the field.

### Phase 7 — device steps for Dan (agent cannot drive the S10)

1. **Dev rebuild required** — `app.json` (permission) + `app/create/ai.tsx` (locked, re-approved)
   both need a fresh dev-client build to reach the device. Build the AI-studio dev variant per
   `docs/dev/AI_DEAL_STUDIO_DEV_APK_SETUP.md` (Dan-gated build).
2. After install on the S10, open AI ads and rebuild the clean draft (**item set manually, NO
   free-text description** — the parser is now hardened, but the manual path is still the surest).
3. Get an image: either **tap "Pick photo"** (now works on Android 12 after the permission fix) and
   choose a coffee photo, OR **Generate ad** and watch the new `console.warn`/quota to see whether
   the AI image now succeeds (credits are fine, so a retry may work; if it still returns no image,
   the QA-unavailable path in the diagnosis is the culprit — capture the logs).
4. Verify the poster → **Publish**.
5. Switch to shopper (`test1@test.com`), capture feed card + deal detail, process to 1320×2868
   (white pad, alpha strip, nav-bar crop) matching the 7 files in `ap store/`, name
   `08_ai_deal_feed` / `09_ai_deal_detail`.


## What was proven on device (do not re-litigate)

1. **The "changes the offer terms" publish wall is NOT a guard bug and NOT a copy bug.**
   `publishDeal()` in `app/create/ai.tsx` (~3365–3413) validates
   `buildPublishMechanicsValidationCopy(offerDefinition)` (a canonical line built from the
   structured offer facts, `lib/offer-version-publish.ts:171-183`) against `offerContract`.
   Merchant-typed headline/subheadline/details are irrelevant to this check, so editing copy can
   never clear the error.
2. **The corruptor is the free-text "Describe the deal" auto-parser**
   `inferDealEligibilityFormFromText` (`lib/deal-eligibility-inference.ts`), applied via
   `applyInferredEligibilityFromHint` (`app/create/ai.tsx:1567`, called at 1584/2264/2524).
   Observed corruptions on device:
   - Typing `2 for 1 latte` → `Customer buys` became `2` (→ canonical "Buy two lattes…" →
     `REQUIRES_TWO_PURCHASES` at publish).
   - Typing `Buy one latte and get one latte free` → both item fields became `B` and the offer
     rule silently flipped BOGO → "Free item" (`BUY_ONE_GET_SOMETHING_FREE`) → same-item canonical
     "get one free" line → `VAGUE_GET_ONE_FREE` at publish.
   - The parser also **overwrites fields the merchant already set manually** and flips a manually
     chosen offer rule.
3. **Confirmed workaround:** set `Customer buys` manually, pick "Buy one, get one free", type NO
   description → green "Eligible offer", and the mechanics guard PASSES (error changed to the
   image requirement). This is the first publish to get past the guard.
4. **Publish requires an image in BOTH ad styles** (Poster and Standard card). Two image sources,
   both dead on this device:
   - **AI image generation:** fails instantly (<3 s), burns no AI use (counter pinned at 24/30).
     Known OpenAI `insufficient_quota` outage (see memory/`docs` notes from 2026-07-07). Fastest
     unblock is non-code: **Dan adds OpenAI API credits.**
   - **Photo picker:** `pickPhotoFromLibrary` (`app/create/ai.tsx:2443`) calls
     `ImagePicker.launchImageLibraryAsync` bare; it throws → `createAi.errPhotoPicker`.
     Root cause: `app.json` android config declares NO media-read permission and explicitly
     **blocks** `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` (`app.json:200-207`). On
     Android ≤12 the library picker needs `READ_EXTERNAL_STORAGE`; on 13+ the system photo picker
     needs nothing. So picking a photo is broken on every Android ≤12 device, dev AND prod.
5. **Misleading error mapping:** `app/create/ai.tsx:2668` maps any failure whose message contains
   "photo" to `createAi.friendlyPhoto` ("We couldn't use that photo…") — shown even when no photo
   was ever attached (pure backend/image-quota failure). Merchants get told to fix a photo that
   doesn't exist.
6. **Navigation reset bug (repro'd once):** in the edit/publish screen, using select-all inside
   "Edit offer details" then typing a long replacement string reset the flow to Step 1 and lost the
   generated image (field left holding one character). Typing into an empty field was safe.

## Locked-file constraints (hard gate — per CLAUDE.md + `docs/ai-poster-core-lock.json`)

- `app/create/ai.tsx`, `lib/deal-offer-contract.ts`, `lib/functions.ts`, and all
  `supabase/functions/ai-generate-ad-variants/*` files are hash-locked. **Each needs Dan's
  explicit per-file approval before editing**, and `docs/ai-poster-core-lock.json` hashes must be
  updated after approved edits (run `node scripts/check-ai-poster-core-lock.mjs`).
- `lib/deal-eligibility-inference.ts` (the parser) and `lib/offer-version-publish.ts` are **NOT**
  hash-locked, but they sit in the AI-create path — state intended behavior to Dan before editing.
- `app.json` permission changes affect the store manifest and need a rebuild → Dan approval.
- No deploys, no builds, no migrations without Dan's explicit go-ahead. Never push.

## Phase 0 — Dan actions (no code)

- **Add OpenAI API credits** (unblocks AI image generation immediately; retries burn no quota).
- Approve the per-file edits below (each listed with exact intended change).

## Phase 1 — Regression fixtures first (no approval needed)

File: `lib/deal-eligibility-inference.test.ts` (unlocked).
Add failing fixtures reproducing the exact observed corruptions:
- `"2 for 1 latte"` must NOT set a buy-quantity of 2 (2-for-1 means buy 1 get 1). Assert either
  `requiredItemDescription: "latte"` with implied qty 1, or `null` (no inference) — decide with
  Dan; recommendation: infer BOGO latte, qty 1.
- `"Buy one latte and get one latte free"` must yield BOGO with both items `latte` — never
  single-letter fields, never a dealType flip to BUY_ONE_GET_SOMETHING_FREE for same-item text.
- Fixture for incremental-typing states (the corrupted `B` values suggest per-keystroke inference
  racing ahead of the text) — feed successive prefixes and assert no partial-word items are ever
  emitted (existing null-on-partial tests at lines 124-128 cover some of this; extend for the
  "and get one latte free" phrasing).

## Phase 2 — Parser hardening (`lib/deal-eligibility-inference.ts` + call sites)

Goal: the parser may only help, never corrupt.
1. Fix the quantity heuristic: "2 for 1", "2-for-1", "two for one" = buy 1 get 1 (same item),
   NOT buy-quantity 2. `REQUIRES_TWO_PURCHASES` phrasing ("buy two") stays qty 2.
2. Fix same-item BOGO detection: "buy one X and get one X free" (same noun) must stay
   `BUY_ONE_GET_ONE_FREE`; only a *different* reward noun may select `BUY_ONE_GET_SOMETHING_FREE`.
3. Reject low-confidence output: never emit item descriptions shorter than 2 words-characters or
   equal to a single letter; return `null` instead of a partial parse.
4. **Call-site rule (needs `app/create/ai.tsx` approval since it's locked):** in
   `applyInferredEligibilityFromHint`, never overwrite a field the merchant has already edited
   manually, and never change `dealType` after the merchant tapped an offer-rule chip. Track a
   simple `touchedByUser` set alongside `eligibilityForm`.
5. Validation: Phase 1 fixtures green + full `npm test`, `npm run typecheck`, `npm run lint`.

## Phase 3 — Honest error messages (`app/create/ai.tsx` — LOCKED, per-file approval)

1. **Guard failure message:** when `validateAiCopyAgainstOffer` fails at publish, the current
   `createAi.offerMechanicsInvalid` text blames the ad copy. Change to a message that points at the
   offer fields and includes the failing reason (reasonCodes already computed), e.g. "Your offer
   setup doesn't match the deal type. Check 'Customer buys' and the offer rule." Add en/es/ko
   strings. Better: run the same validation at the eligibility step and surface it there
   (pre-publish), so merchants never hit it at the end.
2. **Error mapping at `ai.tsx:2668`:** stop mapping every message containing "photo" to
   `friendlyPhoto`. Route image-backend/quota failures (no photo attached) to a new localized
   string, e.g. `createAi.errImageServiceDown`: "Our image service is busy right now. Try again in
   a few minutes, or add your own photo." (en/es/ko). Keep `friendlyPhoto` only for actual
   photo-input rejections.
3. Update `lib/create-ai-generation-outcome.test.ts` / source tests accordingly; bump lock hashes
   with Dan's approval ref; run `node scripts/check-ai-poster-core-lock.mjs`.

## Phase 4 — Photo picker fix (`app.json` + rebuild — Dan-gated)

1. Investigate why `READ_EXTERNAL_STORAGE` is in `blockedPermissions` (git history / release
   docs) — likely Play data-safety minimization. Surface findings to Dan before changing.
2. Recommended fix: declare `android.permission.READ_MEDIA_IMAGES` (API 33+) and
   `android.permission.READ_EXTERNAL_STORAGE` with `maxSdkVersion 32` (use the expo-image-picker
   config plugin `photosPermission` if suitable), and remove `READ_EXTERNAL_STORAGE` from
   `blockedPermissions`. Alternative zero-permission route: ensure expo-image-picker uses the
   Android system photo picker/`ACTION_OPEN_DOCUMENT` fallback on ≤12 — verify on the S10 before
   choosing.
3. Wrap `pickPhotoFromLibrary` failure with the (already decent) `errPhotoPicker` banner but log
   the underlying exception for diagnostics (locked-file edit, fold into Phase 3 approval).
4. Requires dev-APK rebuild (Dan-gated). Prod builds pick the change up at next release.

## Phase 5 — Improvement (Dan product decision): deterministic no-image publish

The template poster ("LATTE BONUS / 2 FOR 1 / LATTE" dark-gradient render) already looks good with
no AI image. Per the repo rule "AI output must pass validation and have a deterministic fallback,"
consider allowing publish with the deterministic poster/template when image generation fails —
instead of hard-blocking on "Every deal needs an image." Locked-area change (`app/create/ai.tsx`,
possibly `lib/ad-spec.ts`); needs Dan's explicit yes/no. If yes, gate it to poster-style ads where
the deterministic render is complete.

## Phase 6 — Repro/fix the edit-field navigation reset

In the edit/publish screen, select-all + long replacement text in "Edit offer details" bounced the
flow back to Step 1 and dropped the generated image. Reproduce (may be keyboard/scroll-driven state
reset or a draft-recovery rehydrate), then fix. Unknown file until repro'd; if it lands in
`app/create/ai.tsx`, fold into the Phase 3 approval request.

## Phase 7 — Finish the original task (after credits + any of Phases 2–4)

1. On the S10, the clean draft is still open in the AI ads editor (BOGO latte, $5.99, item set
   manually, NO description, headline "Buy one latte, get one free", details filled). If lost:
   rebuild it the same way — **item manually, no free-text description**.
2. Generate ad (image should now succeed) → verify poster → Publish.
3. Switch to shopper account (test1@test.com), capture feed card + deal detail with the AI poster,
   process to 1320×2868 (white pad, alpha strip, nav-bar crop) matching the 7 existing files in
   `ap store/`, name `08_ai_deal_feed` / `09_ai_deal_detail`.
4. Cleanup: delete `/sdcard/Pictures/latte-deal.jpg` if unused; leave no stray drafts.

## Validation matrix

| Change | Checks |
| --- | --- |
| Parser (`deal-eligibility-inference`) | new fixtures + `npm test` + typecheck/lint |
| `app/create/ai.tsx` edits | per-file Dan approval → edit → source tests + `node scripts/check-ai-poster-core-lock.mjs` + lock-hash update |
| New user-facing strings | en/es/ko locale files, no hardcoded copy |
| `app.json` permissions | Dan approval, dev rebuild, on-device picker QA on Android 12 |
| Any edge-function change | `npm run typecheck:functions` + focused source tests; deploy only with approval |

## Explicitly out of scope for the agent

Adding OpenAI credits, approving locked-file edits, building/rebuilding APKs, deploying functions,
store submissions.

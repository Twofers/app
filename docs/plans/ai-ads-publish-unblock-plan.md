# AI Ads publish unblock plan (parser corruption + image blockers)

Status: PLAN ONLY — nothing implemented. Written 2026-07-10 after a full on-device diagnosis
(business dev APK `com.unvmex2.twoforone.dev`, physical S10, Android 12).

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

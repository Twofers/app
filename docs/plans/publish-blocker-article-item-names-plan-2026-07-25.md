# Publish blocker: item names starting with "The/A/An" — remediation plan

**Date:** 2026-07-25 · **Branch:** `qa/poster-ad-quality` · **Status: ALL PHASES COMPLETE 2026-07-25. F-1/F-2/F-6 fixed, server redeployed (v200), F-5a/F-5b shipped, F-4 answered. UNCOMMITTED.**

This file IS the tracker. Update the checkboxes and the STATUS line as you go. Investigated, fixed and device-verified 2026-07-25. The fix is in the working tree and **not committed**.

---

## TL;DR for Dan

Any deal whose item name starts with "The", "A", or "An" (like **THE RECON ROAST**) can **never publish**. The app builds its own summary line ("Get 40% off one RECON ROAST" — article dropped for natural English), then a safety check demands the full name ("THE RECON ROAST") appear in that same line. It strips the word, then fails because the word is missing. Nothing the merchant types can fix it, and the error message blames their offer setup, which is actually fine.

The fix is one small function: teach the item-name matcher that "Recon Roast" and "The Recon Roast" are the same item. One fix point heals every affected check on both client and server, because the server imports the same file. Plus a new "generator must satisfy validator" test so this whole class of bug can never ship again.

**Interim workaround (usable today, no code):** rename the item to drop the leading article (`RECON ROAST`), publish, rename back later if desired.

---

## Findings

| # | What | Where | Status |
|---|------|-------|--------|
| F-1 | `PERCENT_OFF_SINGLE_ITEM` with article-prefixed item name can never publish (`MISSING_DISCOUNT_ITEM`) | `lib/deal-offer-contract.ts:517` (generator strips article) vs `:1091` (validator demands full name), wired via `buildPublishMechanicsValidationCopy` (`lib/offer-version-publish.ts:200`) and the pre-flight at `app/create/ai.tsx:3601` | **Reproduced** (vitest, matrix below) |
| F-2 | `BUY_ONE_GET_ONE_FREE` same-item: same class — `formatCountedItem` (`lib/deal-offer-contract.ts:448`) strips the article, `MISSING_BOGO_ITEM` (`:1065`) demands it | same file | Covered post-fix by the invariant test (6 names x BUY_ONE_GET_ONE_FREE) and the CHANGES_FREE_ITEM pair. Not separately reproduced pre-fix |
| F-3 | ~~`BUY_ONE_GET_SOMETHING_FREE` free-item article breaks `CHANGES_FREE_ITEM`~~ — **MISDIAGNOSED, withdrawn.** `CHANGES_FREE_ITEM` (`:1046`, `:1060`) lives in `validateBuyOneGetOneFree` (same-item BOGO), not in the BUY_ONE_GET_SOMETHING_FREE validator, which uses `MISSING_REQUIRED_ITEM`/`MISSING_FREE_ITEM` (`:1021-1022`). The real defect on that path is **F-6** | `lib/deal-offer-contract.ts:1025+` | Withdrawn 2026-07-25; superseded by F-6 |
| F-6 | **Found during Phase 1.** `BUY_ONE_GET_SOMETHING_FREE` whose **free** item name starts with an article: the deterministic description reads "Buy a latte and the House Blend is on us." and trips `FREE_ITEM_ADDED_TO_PURCHASE` (`lib/deal-offer-contract.ts:1003`), whose regex reads "buy X and (the) Y" as the customer buying both. That guard compares raw normalized text and never calls the item matcher, so the Phase-1 fix does **not** cover it. **Not a publish blocker** — publish validates only `canonicalOfferLine`, which passes (proven by the 15-case matrix in `offer-version-publish.test.ts`). It breaks `deterministicFallbackCopy`, i.e. the safety net used when AI copy generation fails | `lib/deal-offer-contract.ts:1003-1005` | **Reproduced**; pinned with `it.fails` in `deal-offer-contract.test.ts`. Fix needs its own approval |
| F-4 | Subheadline rendered `"Save 40% on one  espresso."` — double space + item replaced. Smells like template/dedupe substitution leaving a hole (cf. item-name catch-22 work, 2026-07-18), not AI wording. Cosmetic, not blocking | unknown; suspect item-name dedupe in the ad-variants pipeline | **Not diagnosed — timeboxed investigation, Phase 6** |
| F-5 | UX: in Poster style, the four fields *Edit headline / Edit subheadline / Edit button text / Edit offer details* don't touch the poster (they feed the standard card + stored listing). Only *Poster headline / Poster subheadline* reach the poster (`app/create/ai.tsx:4493`). Reads as "my edits didn't land." Also `createAi.offerMechanicsInvalid` mentions "the free item" even for percent deals and blames the merchant's setup | `app/create/ai.tsx` | By design but misleading — **Phase 5, separate approval** |

### Repro matrix (F-1, verified 2026-07-25)

`validateAiCopyAgainstOffer(buildPublishMechanicsValidationCopy(buildOfferDefinitionV1FromContract(contract)), contract)`:

| Item name | canonicalOfferLine | Result |
|---|---|---|
| `THE RECON ROAST` | `Get 40% off one RECON ROAST` | ❌ MISSING_DISCOUNT_ITEM |
| `The Recon Roast` | `Get 40% off one Recon Roast` | ❌ MISSING_DISCOUNT_ITEM |
| `A Really Big Latte` | `Get 40% off one Really Big Latte` | ❌ MISSING_DISCOUNT_ITEM |
| `latte` | `Get 40% off one latte` | ✅ valid |

Device evidence: analytics `deal_validation_failed {reasonCode: MISSING_DISCOUNT_ITEM, attemptedAction: publish_mechanics_validation, source: create_ai}`; "Publish failed" card on S10.

---

## Root cause, stated once

`validateAiCopyAgainstOffer` checks machine-generated copy against the machine-generated contract. Two independent text pipelines must agree on what "names the item" means:

- **Generators** deliberately strip leading articles for natural English (`stripLeadingArticle` + `lowerFirst` in `buildCanonicalHeadlineFromFacts:517`, `formatCountedItem:448`, plus several candidate builders at `:1131`, `:1160`).
- **The matcher** (`containsItem:838` → `itemNameSearchVariants:827`) accepts only the full name and the parenthetical-stripped core — **not** the article-stripped form.

Any disagreement between the two = a deal that can never publish, invisible until a merchant hits it. The article case is the instance; the missing invariant is the class.

**Why fix the matcher, not the generators:** the generators are right — "Get 40% off one THE RECON ROAST" is broken English on a paid ad, and `canonicalShortTerms` (`:640`) deliberately keeps the full legal name for terms text. Semantically, a leading article is not part of item identity. `normalizeItemForComparison` (`:470`) already strips articles for equality checks — the containment matcher is the one out of line.

**Why the shared helper, not per-call-site patches:** F-1 and F-2 both route through `containsItem`/`itemNameSearchVariants` (call sites `:1014, :1015, :1046, :1060, :1065, :1091`, scoring `:1274-1284`, masking `:846`). The shared helper also fixes the `CHANGES_FREE_ITEM` candidate comparison on the same-item BOGO path, which a per-call-site patch to the MISSING_* checks would have missed.

**Server side:** `supabase/functions/ai-generate-ad-variants/index.ts` imports `validateAiCopyAgainstOffer` **directly from `../../../lib/deal-offer-contract.ts`** — there is no `_shared` twin. The deployed function bundles the old code until redeployed. Publish is NOT re-validated server-side by this predicate (the client pre-flight at `ai.tsx:3601` is the blocker), so the client fix alone unblocks publishing over Metro. Redeploying `ai-generate-ad-variants` afterward is recommended: today the server discards AI candidates that name the item without the article (`index.ts:917`, `:1635`), shrinking the candidate pool for article-named items for no reason.

---

## The change (exact)

`lib/deal-offer-contract.ts` — `itemNameSearchVariants` (line 827). Add article-stripped variants of both the full name and the parenthetical-stripped core:

```ts
function itemNameSearchVariants(itemName: string): string[] {
  const full = cleanText(itemName);
  const core = stripParentheticalSegments(itemName);
  // Leading articles are not part of item identity: generators deliberately
  // write "Get 40% off one Recon Roast" for item "The Recon Roast", and copy
  // that names the core item is fact-safe. Without these variants, every
  // article-prefixed item name fails MISSING_* / CHANGES_FREE_ITEM against
  // the app's own deterministic copy and can never publish.
  const articleStripped = [full, core].map((value) => stripLeadingArticle(value));
  return [...new Set([full, core, ...articleStripped])].filter((value) => value.length > 0);
}
```

Notes for the implementer:
- `stripLeadingArticle` (`:393`) only strips a **leading whole word** `a|an|the` followed by whitespace — `A1 Sauce`, `Apple Pie`, `Theory Latte` are untouched. Degenerate name `"The"` yields an empty stripped variant (filtered out), full name still present.
- Do NOT touch `stripLeadingArticle`, `lowerFirst`, any generator, or `itemRegex`. The regex already handles plural `s?` and whitespace.
- Keep the change to this one function plus its comment. No drive-by refactors — the file is core-locked.

### Consumer audit (all users of the widened variants — verify each in tests)

| Consumer | Effect of widening | Verdict |
|---|---|---|
| `MISSING_DISCOUNT_ITEM :1091`, `MISSING_BOGO_ITEM :1065`, `MISSING_REQUIRED_ITEM/_FREE_ITEM :1014-1015` | Article-stripped mentions now count as naming the item | The fix itself |
| `CHANGES_FREE_ITEM :1046, :1060` | Extracted candidates that lost their article now match the free item → kills F-3 false positive. Trade-off: near-name collisions get slightly looser (free item "The Works" + copy "works platter free" no longer flags). Acceptable: this guard exists to catch the AI *inventing a different item*, and the deterministic fallback still enforces exact facts | Net win, documented |
| `maskProtectedItemNames :846` | Bare-core mentions ("recon roast" without "The") are also masked from banned-word scans — consistent with the mask's stated purpose | Safe |
| Scoring `:1274-1284` | Candidates naming the item without article now score their +2 | Improvement |
| `checkMerchantDealTitleAgainstOffer` (`lib/offer-version-publish.ts:168`) | Only contradiction codes block there (MISSING_* filtered at `:190-196`), so behavior is already tolerant; widening just makes the filler's "omission codes stay quiet" comment true again | Safe |

---

## Phase 0 — Approvals (Dan; nothing proceeds without this)

Per CLAUDE.md, each locked file needs individual approval. **None granted yet.** Requested edits:

- [ ] **`lib/deal-offer-contract.ts`** — widen `itemNameSearchVariants` exactly as specified above; no other change. Validation impact: publish mechanics pre-flight, AI candidate filtering, copy scoring, banned-word masking all accept article-stripped item mentions. Deploy impact: none required for publish unblock (client via Metro); `ai-generate-ad-variants` picks it up at its next (separately approved) deploy.
- [ ] **`lib/deal-offer-contract.test.ts`** — add regression + invariant tests (list below); no existing assertions changed unless one *documents* the broken behavior.
- [ ] **`lib/offer-version-publish.test.ts`** — add the publish-mechanics invariant test.
- [ ] **`docs/ai-poster-core-lock.json`** — refresh hashes for the three files above; chain `latestApprovalRef` with a `Prior ref:` line per the lock protocol (never overwrite the chain).

Record Dan's actual approval wording and date here before starting Phase 1:

> _Approval:_ Dan, 2026-07-25 — "approved, run phases 1-3". Scope = the four files listed above, Phases 1 through 3 only. Phases 4-6 remain ungated.

Phases 4-6 have their own approval gates below — do NOT bundle them into this one.

## Phase 1 — Fix + tests (after Phase 0 approval) — DONE 2026-07-25

- [x] Apply the `itemNameSearchVariants` change (`lib/deal-offer-contract.ts:827`, +7/-2).
- [x] `lib/deal-offer-contract.test.ts` (+137): article/non-article acceptance, the generator-vs-validator invariant (6 item-name shapes x 3 deal types), the still-rejects-a-different-item negative, and the CHANGES_FREE_ITEM negative+positive pair. Corrected mid-flight: CHANGES_FREE_ITEM lives in the same-item BOGO validator, not the BUY_ONE_GET_SOMETHING_FREE one, so that test was retargeted.
- [x] `lib/offer-version-publish.test.ts` (+73): the exact publish pre-flight over a 15-case matrix (3 deal types x 5 item names) plus `checkMerchantDealTitleAgainstOffer`.
- [x] F-6 discovered and pinned with `it.fails` rather than silently widened into this diff (see findings table).
- [x] `docs/ai-poster-core-lock.json`: hashes recomputed (CRLF-normalized, matching `normalizedSha256`), `latestApprovalRef` chained with `Prior ref:` on all three files.
- [x] Validation, all green:
  - [x] `npm run gate:ai-poster-lock` — 30 protected files match locked hashes
  - [x] `npm run typecheck` — clean
  - [x] `npm run lint` — clean
  - [x] `npm test` — **282 files, 1979 tests, 0 failures** (no pre-existing failures)
  - [x] `npm run typecheck:functions` — exit 0
  - [x] `npm run copy:evaluate` — exit 0, no fixture drift
- [x] Diff scope confirmed: exactly the 4 approved files. `deno.lock` was rewritten as a side effect of `typecheck:functions` (unrelated social-sign-in deps) and was reverted.

## Phase 2 — Device QA on the S10 — DONE 2026-07-25

- [x] Fix reached the device via Fast Refresh (Metro rebuild `lib/supabase.ts (636 modules)`). Note: the dev-client deep link re-enters the screen but does **not** force a JS reload — boot-log count stays at 1. Check `grep -c 'twoforone:boot'` before trusting a "reload".
- [x] Tapped **Publish deal** on the unchanged draft (item `THE RECON ROAST`, 40% off, Poster style).
- [x] Result: cleared the mechanics gate that previously blocked it. `ai_ads_fields_edited_before_publish` then `ai_ads_published_with_ai_draft {draft_edited:true}` fired; **no `deal_validation_failed`**. App navigated to Offers with "40% off The Recon Roast Espresso is now live for customers." and the deal listed as Scheduled 9:04-10:04 AM.
- [x] Evidence: `artifacts/qa/2026-07-25-article-item-publish/` (01 before, 02 poster-edit-landed, 03 publishing, 04 live). Local only, not committed.
- [x] AI generations consumed: **zero** — the existing draft was republished, no regeneration needed.
- [x] Consumer-facing copy reads naturally: card "Get 40% off THE RECON ROAST"; poster headline "RECON ROAST FOR LESD" exactly as typed.

## Phase 3 — Report to Dan — DONE 2026-07-25

- [x] Plain-language summary delivered, including F-6 as newly found and deliberately out of scope.
- [ ] Commit decision: **not committed.** Awaiting Dan. Branch also carries unrelated WIP (`android/app/build.gradle`, `eas.json`, `website/vercel.json`, `docs/website-edit-checklist.md`, untracked website/ + scripts/ work) — commit only the 4 fix files plus this plan.

## Phase 4 — Server redeploy of `ai-generate-ad-variants` — DONE 2026-07-25

- [x] Deploy approved by Dan explicitly (hard gate).
- [x] Deployed from this repo directory against prod ref `kvodhiqhdqnptqovovia` (confirmed `linked: true`, name "Twofer Production") **after** F-6 landed, so the deployed bundle carries both fixes.
- [x] `ai-generate-ad-variants` **version 199 -> 200, status ACTIVE**.
- [x] `npm run typecheck:functions` exit 0 before deploying.
- [ ] Post-deploy generation smoke on device: **not run** — would consume an AI credit, and the deployed change only widens candidate acceptance (it cannot make generation stricter). Worth folding into Dan's next real generation.

## Phase 5a — Deal-type-aware mechanics message — DONE 2026-07-25

- [x] `app/create/ai.tsx`: percent-off deals now use `createAi.offerMechanicsInvalidPercent`; free/BOGO keep `createAi.offerMechanicsInvalid`.
- [x] Both variants drop "Your offer setup doesn't match this deal type", which blamed merchant configuration for a self-consistency failure in generated copy. The percent variant drops "the free item" — a field that does not exist on that form.
- [x] New key added to `en`, `es`, `ko`. `npm run check:i18n-keys` PASS (locale parity holds, no untranslated keys). Spanish accents verified intact, no mojibake, no file reformatting (3-line diffs).
- [x] Lock hash + chained approval ref updated for `app/create/ai.tsx`.
- [ ] On-device visual check: **not possible** — the message only renders when publish mechanics validation fails, which the Phase-1/F-6 fixes now prevent for these inputs. Verified by typecheck, i18n parity gate and the locked `create-ai-ux-source` suite instead.

## Phase 6 — F-4 probe — DONE 2026-07-25, ANSWERED: not a code defect

Traced the `"Save 40% on one  espresso."` double space to its origin:

- All three `Save X% on one <item>.` templates (`deal-offer-contract.ts:554`, `:1171`, `ai-revision-fallback-copy.ts:210`) clean their interpolated item via `cleanText`/`lowerFirst`, so none can emit a leading space.
- **Decisive:** every AI variant passes through `cleanVariant`, where `short_description: compactText(cleanText(description), ...)`. `cleanText` collapses `\s+` to a single space, so **a double space cannot survive the AI path**.
- No item-name substitution exists in the pipeline: `maskProtectedItemNames` is validation-only (`:967`), and every `.replace(...)` in `ad-variants.ts` is followed by a `\s{2,}` collapse.

Therefore the double space was introduced in the editable **Edit subheadline** field — a merchant edit, consistent with Dan actively editing at the time (the poster headline read "RECON ROAST FOR lesd", a half-typed word). Confirmed on device: after Duplicate deal, that field is empty with its placeholder — the value was never regenerated because it was never generated that way.

**Genuine minor gap found, NOT fixed (no approval sought):** `composeListingDescription` (`lib/ad-variants.ts:101`) only trims the ends of merchant text; it does not collapse internal whitespace. A merchant-typed double space publishes verbatim. Cosmetic polish, one line, in a locked file — flag to Dan if he wants it.

## Phase 5b — Poster-mode field clarity — DONE 2026-07-25

- [x] `app/create/ai.tsx`: when `showPosterFormat`, a muted one-line caption `createAi.posterListingFieldsNote` sits above the four listing fields.
- [x] Copy: EN "These edit the deal listing, not the poster." + es/ko. Fields are **labelled, not hidden** — they genuinely feed `deals.title`/`description` via `composeListingDescription` (`ai.tsx:3619-3623`).
- [x] `npm run check:i18n-keys` PASS; locked `lib/create-ai-ux-source.test.ts` still passes (34 tests).
- [x] Lock hash + chained approval ref updated.
- [x] **Device-verified** on the S10 via Duplicate deal (zero AI generations): caption renders in muted grey between the poster fields and "Edit headline". Evidence: `artifacts/qa/2026-07-25-article-item-publish/05-poster-listing-fields-caption.png`.

## Final validation (after all changes)

`gate:ai-poster-lock` 30/30 · `typecheck` clean · `lint` exit 0 · `npm test` **282 files / 1980 tests / 0 failures** · `typecheck:functions` exit 0 · `copy:evaluate` exit 0 · `check:i18n-keys` PASS.

**AI generations consumed across the entire session: zero** (1 `ai_ads_generation_succeeded` in the Metro log, from before this work began).

`deno.lock` is rewritten as a side effect of `typecheck:functions` and of `supabase functions deploy` (unrelated social-sign-in deps); reverted each time.

---

## Risks & mitigations

- **Loosened near-name matching** in CHANGES_FREE_ITEM (documented above). Mitigated by the still-firing negative test and by deterministic fallback enforcing exact facts.
- **Lock-gate ordering:** `npm test` fails until `ai-poster-core-lock.json` hashes are refreshed — expected; refresh only after the approved edits, and keep the approval chain (`Prior ref:`) intact.
- **Deployed server lag:** until Phase 4 runs, prod generation keeps the old matcher. Impact: fewer surviving AI candidates for article-named items — same as today, no regression.
- **This branch has unrelated WIP** (untracked docs, scripts, website changes). Touch nothing outside the listed files; never delete untracked artifacts.

## Non-goals

- No changes to generators/canonical phrasing, poster templates, prompts, or `ad-spec.ts`.
- No commit/push/tag/deploy/migration without Dan's explicit word (hard gates).
- No broad refactors of the validator; one function + tests is the whole Phase 1 diff.

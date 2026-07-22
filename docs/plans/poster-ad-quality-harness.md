# Poster Ad Quality Harness — operator brief for Opus 4.8 (max) — RUN 2

Status: **RUN 2 EXECUTED** across four sessions (2026-07-20 → 2026-07-21). **§1b is the run-2 ledger — read it with §1a before doing anything.** **Every rubric surface has now been judged** — session 4 closed the last two (shopper feed poster card and deal detail) at zero cost, in en/es/ko. What remains is in §1c and is now mostly **decisions for Dan plus one deploy**, not device work. Live report: `artifacts/poster-quality/2026-07-20-run2/REPORT.md`.

Run 1 (2026-07-20) is complete: report at `artifacts/poster-quality/2026-07-20/REPORT.md`, deploys in `DEPLOY_LOG.md`, dispositions in `RUN_LEDGER.md`, all on branch `qa/poster-ad-quality`. **§1a below is the do-not-repeat ledger — read it before doing anything.** Companion history: `docs/plans/first-deal-ai-quality-harness.md` (lane-coverage run, also executed).

## 1. Mission (unchanged bar, shifted target)

The poster must look like a professional ad a marketing team would produce. Run 1 fixed the **floor**: text is now legible over photos, BOGO images fill the frame, the fallback is portrait. Run 2 raises the **ceiling**: activate the adaptive scrim server-side, prove quality across the visual-stress matrix that was never generated (services, busy/colorful/dark subjects, KO/ES, text-fit limits), lift copy craft, and finally prove the whole thing end-to-end with real publishes — none happened in run 1.

Definition of done: the §7 rubric passes across the **expanded** corpus (mean ≥4.2, no dimension mean <3.5, no cell <3, zero hard fails), with at least 4 end-to-end published-and-ended journeys among the evidence, OR stop criteria (§9) reached with a ranked report.

## 1a. RUN 1 LEDGER — done, deployed, decided. DO NOT REDO.

| Item | Status | Evidence / where it lives |
|---|---|---|
| **P3 legibility (HIGH):** `fresh` template dark-teal ink over photos → ~1.1:1 contrast, headline invisible on dark images | **FIXED (client)** — light ink over photos + luminance-aware top scrim (`spec.luma.top`, 0.66 fallback), both V1 and V2. **Ships only on next Android build.** | commit `18afd6d7`; proof `corpus/i01/`, `corpus/i02/` render_fixed vs render_v1/v2 |
| **P1 letterbox:** BOGO/two-item images generated with flat cream bands | **FIXED + DEPLOYED + SMOKED** — prompt demands edge-to-edge full bleed; live BOGO smoke is band-free | commit `a8e414fe`; deploy row 2026-07-20; `corpus/validate/bogo_latte_after.png` |
| **P2 square fallback:** gpt-image-1 residual fallback returned 1024×1024 → cropped in 4:5 | **FIXED + DEPLOYED** (deterministic 1024×1536). Residual path **not smoke-tested** (quota) — that verification is run-2 work, the fix is not. | commit `a8e414fe` |
| **F4 (branded item names kill image gen)** | **FIXED + DEPLOYED before run 1** — category-safe Gemini retry; verified live (Sergeant's Stripes 125s→dead-end became 101s→success). The old "disposition the uncommitted ai-image-provider.ts diff" task is **obsolete** — it was committed as `5a63ce88`+`798f63aa`. | first-run commits; RUN_LEDGER D1 |
| **V1 vs V2 verdict** | **DECIDED: recommend V2** (gold offer badge + Outfit_900Black headline). Do not re-score V1-vs-V2. Flip + rebuild is **Dan's pending decision**, not run-2 agent work. | REPORT §2; i01/i02 v1-vs-v2 renders |
| **Renderer-flag audit** | **DONE — trust RUN_LEDGER D2 unless envs changed:** shopper feed + deal detail use the shared renderer in BOTH prod and dev (parity); `POSTER_LOOK_V2` false everywhere (V2 fully dormant); create-preview *extras* differ dev-vs-prod (UX only, not final pixels). A/B V2 by restarting Metro with `EXPO_PUBLIC_POSTER_LOOK_V2=true` inline — **never edit Dan's `.env.development.local`.** | RUN_LEDGER D2 |
| **Tooling** | **BUILT + COMMITTED — reuse, don't rebuild:** dev gallery `app/poster-gallery-dev.tsx` + `lib/dev/poster-gallery-corpus.ts` (renders corpus specs through real `AdPosterCanvas`, `forceLookV2` prop for A/B); contrast checker `scripts/qa/poster-contrast-check.mjs` (`--bg` modeled / `--shot` rendered crop; <3:1 large text = hard fail). | commit `2416959c`; REPORT §4 |
| **Corpus seed** | EXISTS: i01 (light latte) + i02 (dark Sergeant's Stripes) device-rendered v1/v2/fixed, BOGO-latte validation shot, `band-luma.json`, plus first-run response specs (~12 `ad.poster` specs mapping straight onto the `AdPosterCanvas` spec prop). **Extend it; don't regenerate these cells.** | `artifacts/poster-quality/2026-07-20/corpus/`; RUN_LEDGER seed note |
| **Quota reality** | Monthly per-business ad-image quota is the binding cap, not the $20: **23/30 used → ~7 generations left** this month after run 1's single smoke. Run 1 deliberately did NOT self-raise quota (the only path was the tainted service key). | RUN_LEDGER D3; SPEND_LOG |
| Publishes | **0 deals published in run 1** — E2E proof is entirely run-2 work. | DATA_LEDGER |

**Still open from run 1 (this IS run-2 work):** null `luma` fix (§6 Tier 0), P2 residual smoke, D4 font check (KO/display fonts on device — was left pending), corpus expansion, copy craft gates, image-prompt craft beyond P1, E2E journeys, and cleanup of the one orphan smoke image in `deal-photos` (ledgered in run-1 DATA_LEDGER).

**Dan's pending decisions (outside agent scope, listed for context):** rebuild to ship `18afd6d7`; flip `EXPO_PUBLIC_POSTER_LOOK_V2` default (recommended) + rebuild; bump the monthly ad quota; rotate the previously pasted `sb_secret_…` service key and delete `.env.qa.local` when runs are finished.

## 1b. RUN 2 LEDGER — executed 2026-07-20/21. DO NOT REDO.

Branch `qa/poster-ad-quality`. Evidence in `artifacts/poster-quality/2026-07-20-run2/`
(`REPORT.md`, `FINDINGS.md`, `DEPLOY_LOG.md`, `DATA_LEDGER.md`, `SPEND_LOG.md`, `harness/`).
**Nothing pushed.** Eight commits; `0fafc609` `829c94c0` `bb4408b9` from sessions 1–2, then
`8aa075c4` (R9) `fd3aa5a3` (R7) `98ce6e01` (R12).

| Tier | Status | Notes |
|---|---|---|
| **Tier 0** — luma, P2 residual, D4 fonts, ANCHORS | **DONE** | Luma verified live (`source: "upstream"`, local recompute matched to 0.0000). D4 PASS. `ANCHORS.md` written. |
| **Tier 1** — spec-mutation stress, copy gates, template polish | **PARTIAL** | Copy gates landed (R5/R6). Text-fit limits PASS. Template/palette polish **not attempted**. |
| **Tier 2** — corpus expansion + image craft | **DONE** | 5 new categories. Zone-composition prompt deployed: top-band busy-ness 0.301 → 0.223 (−26%), 2 of 3 inversions fixed; **m04 still inverted, and J3 measured 0.192 top vs 0.172 mid live — the inversion is reduced, not eliminated.** |
| **Tier 3** — E2E journeys | **DONE — 5 published, 5 ended, 0 left live** | J1 latte · J2 cold brew · J3 muffin BOGO · J4 coffee bag · J6 croissant BOGO. Each verified live from owner **and** QA-customer sides, then ended, then confirmed gone from the shopper read. J5 was blocked by R13 and its draft discarded. |
| **Tier 3 owner surfaces** | **DONE (session 3)** | Dashboard card, "Review live deal"→analytics, Manage sheet, Print flyer. See FINDINGS. |
| **Tier 4** — regression | **DONE except the corpus re-render** | 1810/1810 tests, lock gate 30/30, `copy:evaluate` 33/3/7, typecheck + lint + `typecheck:functions` clean. Full-corpus re-render against final code **not run**. |

**Fixed, deployed and verified live this run:** R1 (scrim *reach*, not the target constant —
the plan's own prescription measured as a **no-op**), Tier-2 image craft, R5/R6 copy gates,
R7 (`posterItemLabel` discarding the words that name the product), R9 (offer fact line
truncating to a dangling modifier), R12 (removal of the unrenderable poster subheadline).

**Retracted after measurement — do not re-raise without new evidence:** the J3 "letterbox"
suspicion (0/41 flat rows; it was the scrim working), and **R10** — wiring poster copy into
`evaluateAdCopyStyleGate` was measured to reject **none** of the three observed failures,
and R12 then showed the kicker could never render at all, mooting it.

## 1c. STILL OPEN after run 2 — ranked. **Item 1 was closed in session 4.**

1. ~~**CUSTOMER-SIDE — shopper feed 3:2 card and deal detail: STILL NEVER JUDGED.**~~
   ✅ **DONE in session 4 (2026-07-21), at zero cost.** Both judged, plus the business page,
   in en/es/ko. 0 generations, 0 publishes, 0 pushes, no account switch — **the premise of
   this item was wrong**: it assumed a fresh journey was needed because no live deal existed,
   but Dan's pre-existing cookie deal already carries a real poster spec. Two corrections
   that follow from the evidence:
   - **The feed card is 4:5, not 3:2, and nothing is cropped.** §11 below is imprecise — 3:2
     is the image slot of the *non-poster* templates. Fix that instruction before reusing it.
   - The feed could not show the deal at all for this account (ZIP 76051, radius maxed at
     10 mi, business ~13 mi away). It was reached through the **search box**, which ignores
     the radius. See S12.

   Produced findings **S1–S15**. Headlines: **S1 (HIGH)** Spanish posters delete the word
   GRATIS — fixed, not deployed; **S9 (HIGH)** the Korean deal title is a field dump and the
   stored `title_ko` is never consulted; **S2 (HIGH)** every non-English poster prints its
   headline and offer line as the same string.
2. **CUSTOMER-SIDE — claim/redeem journey. ON HOLD (Dan, 2026-07-21).** Never exercised in
   either run: claim as the customer, redeem via the owner's Redeem tab, confirm the QR/claim
   states. Do not run without Dan re-authorising, and pair it with a throwaway deal — a real
   claim is irreversible and posts to the owner's analytics.
3. ~~**R13 (HIGH) — a valid 40%-off deal can be blocked from publishing by the model's word
   choice.**~~ ✅ **FIXED (`6db42df5`).** `structuredOfferIsStrong` consults the merchant's
   validated contract (free-item type, 100%-off reward, or discount ≥40) as an authoritative
   PASS, so the offer no longer publishes-or-fails on the model's synonym. Placed below the
   shape rejections, so no offer that passes today starts failing. **SQL twin migration
   `20260721170000` written and committed, NOT applied — Dan's gate;** run
   `scripts/probe-strong-deal.mjs` for parity after applying. Client also needs a rebuild.
4. ~~**R9 residual** — the same front-fill truncation still affects the embedded-item
   compositions (`WITH <item>`, `FREE <item>`), which need a per-locale budget.~~
   ✅ **FIXED in session 4** as S1/S3, and it was worse than predicted: in Spanish the clamp
   deleted **GRATIS**, so a BOGO poster carried no word saying anything was free. English
   states the offer with a prefix so the clamp only ever shortened the item; es/ko state it
   with a suffix. `composeOfferLine` now measures the affix and fits the item to what is
   left; `fitLocalizedItem` adds a head-initial fitter for Spanish. English and Korean output
   is byte-identical. **Uncommitted, and NOT deployed — the edge function imports this file,
   so new generations need a deploy.**
5. **R4 residual** — should an exhausted image chain return a copy-only ad instead of
   `IMAGE_REQUIRED`? Deferred twice at Dan's direction. R11 is fresh evidence it still fires.
6. **Owner-surface gaps (LOW)** — no poster preview on "Review live deal"; "Print flyer"
   goes straight to the OS share sheet with no in-app preview; the publish banner claims
   "now live" up to a minute before `start_time`.
7. **Tier 4 corpus re-render** against final code, and the optional m04 image-craft re-run.
8. **Free-text parser (UNRESOLVED)** — discount-first phrasing ("40 percent off a …") yields
   no item extraction, and a partial value captured mid-typing is never corrected. Needs a
   human-paced test before acting.

### New in session 4 — customer-side. Full detail and evidence in FINDINGS S1-S15.

9. ~~**S9 (HIGH) — in Korean the deal title is a database dump.**~~ ✅ **FIXED `551393e4`**,
   and the diagnosis was half wrong. The dump is a **deliberate placeholder** (template
   version `"pending-native-review"`) that avoids guessing a Korean counter word; the real
   defect was that `resolveKoreanOfferTemplate`'s **reviewed-counter branch was never
   written**, so counters a native reviewer already approved were computed and thrown away.
   Now `라떼 1잔 구매 시 라떼 1잔 무료`. Unreviewed terms keep the dump, pinned by its own
   test. **The two sentence frames still need native review** (the counters have it, the
   frames don't). Cause 2 — preferring `deals.title_ko` — was investigated and
   **deliberately not done**: it bypasses the verified-localization gate
   (`approved_localization_storage`) and trades fact integrity for copy. Dan's call.
10. ~~**S2 (HIGH) — every non-English poster prints its headline and offer line as the same
    string.**~~ ✅ **FIXED `bbba3bef`.** Dan approved "make the hero the reward"; that shape
    proved impossible because `validatePosterSpecV1` binds **both** offer lines to the
    deterministic lines for every locale, so any hero drawn from the facts duplicates one of
    them. The hero is left **empty** for locales with no translated headline instead — legal
    because a missing headline is a policy warning, not a failure. Includes a renderer-side
    equality guard, which is the only thing that can stop **already-published** es/ko posters
    printing twice, since specs are never backfilled.
11. ~~**S13 (MED) — the English deal description states the offer three times.**~~
    ✅ **FIXED (`6b4bf333`).** `joinUniqueText` now drops a line whose significant tokens are
    ≥60% covered by an earlier line and ends every kept line with punctuation. Token
    comparison is Unicode-aware (a 2-char Hangul word counts), after a first pass wrongly
    deleted the Korean offer line. Verified live. Not locked; rebuild + the three
    `viewer-locale` functions.
12. ~~**S4/S6 (MED) — poster specs are frozen and never backfilled.**~~ ✅ **FIXED
    (`be50daf0`).** `AdPosterCanvas` takes an optional `merchantName` and the feed card,
    business page and create-preview all pass the live name; because it substitutes at
    render, it repairs **already-published** posters too. Verified live (poster now reads
    "The Colonel's Brew"). The broader "nothing backfills a frozen spec" observation (S6)
    stands for fields other than the business name — those still only change on regen.
13. ~~**S11 (MED)** — the business page renders the raw photo instead of the poster.~~
    ✅ **FIXED (`6b4bf333`)**, verified live. ~~**S14 (MED)** — the feed countdown ignores
    the recurring window.~~ ✅ **FIXED (`674a1f7a`)**, verified live ("8d 7h left" → "6h 2m
    left"). **S12 — RETRACTED, not a bug:** `shouldShowDealInNearbyFeed` already exempts
    favourites from the radius; the deal was hidden by its window at the time, and the feed
    was never scrolled to the bottom where it sorts last. Confirmed present live.
14. **CUSTOMER-SIDE — claim → redeem journey (was §1c item 2): ON HOLD, Dan's call
    2026-07-21 ("hold off").** Both entry points were reached and photographed but not
    pressed. Claiming permanently consumes this customer's one allowed claim on Dan's live
    deal and posts into the owner's analytics, and the redeem half needs the owner account.
    **Do not exercise this without Dan re-authorising it**, and when he does, pair it with a
    throwaway deal rather than a real one.

**Rebuild-gated regardless (Dan's call):** `18afd6d7` legibility, `0fafc609` scrim reach,
R7/R9 client-side, R12's UI removal, session 4's S1/S3 fix, and the
`EXPO_PUBLIC_POSTER_LOOK_V2` flip. **Deploy-gated:** S1/S3 also needs an edge deploy to reach
newly generated posters.

## 2. Authority and standing approvals (signed by Dan — unchanged from run 1)

Standing approval to edit locked AI files without per-file stops, scoped to the poster pipeline — the same file list as run 1: `components/poster/*` (AdPosterCanvas + tests, posterTemplates), `lib/poster/*` (posterCopy/Policy/Types/AdSpec + tests), `lib/poster-canvas-source.test.ts`, `lib/ad-spec.ts`, `lib/ad-variants.ts`, `lib/deal-offer-contract.ts` (+ tests), `lib/functions.ts`, `lib/create-ai-ux-source.test.ts`, `app/create/ai.tsx`, `supabase/functions/ai-generate-ad-variants/index.ts` + `prompt.ts` (+ tests), `supabase/functions/_shared/ai-image-provider.ts`, `_shared/dalle-image.ts` (+ tests), `_shared/ai-generate-ad-variants-poster-copy-source.test.ts`, `fixtures/ai-poster-copy-offers.json`, `scripts/evaluate-ai-promotional-copy.mjs`. Non-locked poster surfaces under normal rules: `components/composed-ad-card/templates/PosterOfferTemplate.tsx`, the 3:2 feed-card presentation, `lib/quick-deal-image-qa.ts`, `lib/runtime-env.ts` plumbing, and the existing dev gallery files.

Conditions (all mandatory, same as run 1): one `[aiqa]` commit per change with explicit paths; `docs/ai-poster-core-lock.json` updated at end of run for every locked file touched (approvalRef `2026-07-20 Dan standing approval (poster ad quality harness run 2)`); deal facts authoritative; generic fixes only, fixtures + regression tests in the same commit; deterministic fallbacks survive; no raw provider bodies or secrets exposed.

**Still hard-gated — stop and ask Dan:** push/merge/rebase/reset; migrations, `db push`, any DDL; builds, store submission, version/signing (the V2 default flip is a commit Dan must rebuild to ship — recommending is fine, building is not); secrets — and specifically: **never use the previously pasted service key for anything, including quota changes**; editing CLAUDE.md/AGENTS.md, RLS, billing/claim/redemption code; deleting or modifying any data not created by these runs (run-1 ledgered artifacts may be cleaned).

## 3. Rollback — same four-ledger contract, run-2 baseline

All run-2 ledgers under `artifacts/poster-quality/<run-2 date>/` (new dir; run-1 dir is history, don't rewrite it).

- **Code:** continue on branch `qa/poster-ad-quality`. Record `BASELINE_SHA_RUN2 = a8e414fe` (current tip = run-1 final state) in the new `RUN_LEDGER.md`; snapshot `git status --porcelain` (expected: only the two untracked plan docs). One `[aiqa]` commit per change. Undo run 2 alone = revert commits after `a8e414fe`.
- **Deploys (`DEPLOY_LOG.md`):** currently-deployed `ai-generate-ad-variants` is `a8e414fe` — **that is run 2's rollback target.** Restoring `798f63aa` would also undo run 1's deployed P1/P2 fixes; document both in the log but only roll back that far if Dan explicitly wants the full unwind. Same worktree rule: deploy only from inside the checked-out dir being deployed; smoke immediately after every deploy; kill switch target <5 min.
- **Data (`DATA_LEDGER.md`):** every deal (publish + end times), draft, storage object, device seed file, and any quota/admin value change (old → new → restored-at). Run 2 may also delete the run-1 orphan smoke image (carry its ledger line over, mark disposed).
- **Spend (`SPEND_LOG.md`):** per-call totals AND a quota countdown column (used/30). Hard stops per §9.

## 4. Environment and tooling — mostly exists; preflight is the real work

Same device recipe: S10 `RF8T20X0Z7P`, prod-package dev client, `adb reverse tcp:8081 tcp:8081`, `EXPO_NO_METRO_LAZY=1 npx expo start --dev-client`, deep link `twoforone://`, screenshots via the `sh` skill. Account: the business signed in on the S10 (The Colonel's Brew, business_id in run-1 REPORT); API-tier creds in gitignored `.env.qa.local` — recreate with Dan re-entering the password; never reuse anything pasted in chat.

**Reuse, don't rebuild:** the gallery (`app/poster-gallery-dev.tsx` + `lib/dev/poster-gallery-corpus.ts`) and contrast script. Known quirk: on Windows Metro, a **new route file needs a full JS reload** to register — run 1 rendered the gallery via a temporary `debug-diagnostics` hijack (reverted); budget for the same dance if adding routes.

**Preflight (blocking order):**
1. **Quota.** ~7 generations remain of 30 this month. Run 2's paid tiers need ~25–30. **Dan must bump the per-business monthly ad quota out of band before the run** (admin UI / his call — the agent must not self-raise via the tainted key). Record the pre-run and post-run values in the ledger. If the bump hasn't happened: run the free tiers (Tier 0 luma code + Tier 1) and stop before Tier 2/3 with a partial report.
2. **Confirm deployed baseline** = `a8e414fe` (one no-spend health call / version marker check) so the rollback chain in §3 is true.
3. **Flag parity re-check only if envs changed** since RUN_LEDGER D2 (otherwise trust it).
4. **D4 font check (carried over, still pending):** verify Outfit_900Black / BlackHanSans_400Regular actually load on the S10 dev client (`useFonts` silently falls back — a KO headline in system font is an instant finding). Piggyback on the first gallery render.

## 5. Pipeline map — run-1 verified facts added

Same flow as run 1 (owner input → `ai-generate-ad-variants` copy + image → poster payload → spec → policy/limits → AdPosterCanvas surfaces). New verified facts to build on, not rediscover:

- **Image provider order:** Gemini native 4:5 → on refusal, **F4 category-safe Gemini retry (usually rescues, ~100s total)** → gpt-image-1 residual fallback (now portrait 1024×1536, untested live).
- **`poster.luma`:** computed server-side but **null in prod responses**. Root cause candidates (DEPLOY_LOG): pngjs `sync.read` under Deno node-compat, or upload→immediate-redownload timing. The committed wiring re-downloads the just-stored image; the proper fix is to **thread the in-memory image bytes** into poster-spec assembly (`computeImageBandLuminance` is already committed + unit-safe). Fail-safe today: client 0.66 fallback scrim (rebuild-gated), so this is polish that should land **before Dan's rebuild** so new posters get the adaptive scrim on day one.
- **No `supabase functions logs` via CLI** — diagnose edge behavior from responses, stored artifacts, and cost-ledger rows, not server logs.
- Text lives only in the native overlay; clean image pixels remain a locked hard-fail rule.

## 6. Run-2 work plan (rescoped tiers)

**Tier 0 — Land the leftovers (≤2 generations).**
1. **Luma fix:** thread in-memory bytes to the spec builder in `ai-generate-ad-variants` (kill the hot-path re-download), unit-test on fixture bytes, deploy, smoke with ONE generation → assert `poster.luma` non-null and sane (compare against `band-luma.json` expectations for a similar image), and render that spec in the gallery to see the adaptive scrim engage with real luma. This is the highest-leverage remaining item.
2. **P2 residual smoke (quota-permitting, 1 generation):** force the residual path only if it can be reached without deploying experiments (e.g. an input the category-safe retry also refuses); otherwise leave it unit-verified and say so in the report.
3. D4 font check + anchor board: write `ANCHORS.md` (run 1 never did) — 1/3/5 exemplar descriptions per §7 dimension, seeded from run-1 FINDINGS so scoring stays consistent.

**Tier 1 — Free loops (zero generations).**
- **Spec-mutation stress cells over EXISTING backgrounds:** KO (BlackHanSans) and ES (diacritics) poster copy, 28-char headlines, 34-char business names, every offer-block width — hand-built specs are legitimate here because the renderer doesn't care where the spec came from. Render in the gallery (V2 per run-1 verdict; spot-check V1 parity for existing shipped posters), contrast-check every cell.
- **Copy craft gates** (untouched in run 1): headline-hookiness and kicker-congruence style gates in `prompt.ts` — pattern-level, with fixture + `copy:evaluate` updates in the same commit. Validate on text-only calls (cheap dollars, zero image quota).
- **Template/palette polish in the gallery:** offer-badge styling, margins, business-name treatment, palette-aware template treatment if `poster.luma`/palette data makes it possible — A/B against the corpus, before/after screenshots per change.

**Tier 2 — Paid corpus expansion + image craft (quota-gated, ~15–20 generations).**
- Generate the **missing matrix cells** (never done in run 1): hard-to-photograph services (nail set, barber fade, oil change), busy/colorful (nachos, açaí), more dark subjects (brisket, chocolate), photogenic range (birria, boba) — each captured into the corpus and judged in all three surfaces.
- **Image-prompt craft beyond P1:** composition direction (subject in the middle band, calm top/bottom where the overlay lives), category-aware styling/lighting language, background simplicity. Every prompt change validated on matched regen cells (same copy, pre/post images) — never on unmatched content.
- **Image-QA calibration** only if Tier-2 evidence shows good images being discarded or bad ones passing (run 1 found no such case; don't churn it speculatively).

**Tier 3 — End-to-end proof (4–6 generations).** Fresh owner journeys on the S10 through the real create flow → publish → judge the live deal in real surfaces (feed 3:2, detail, owner view) → **end each deal immediately after judging** (standing rule). This is where latency/friction dims finally get scored with the full pipeline live (luma included).

> **RUN-2 STATUS (2026-07-21): publishing and the OWNER VIEW are done — 5 journeys published and ended, owner surfaces judged (§1b). The two CUSTOMER-SIDE surfaces named in this tier, `feed 3:2` and `detail`, are STILL UNJUDGED** and are item 1 in §1c. They cannot be closed from the business account: they need the QA customer signed in on the device, plus a live deal to look at. Do not mark Tier 3 complete until they are done.

**Tier 4 — Regression.** Re-render the FULL corpus (run-1 cells + run-2 cells) with final code — free; contrast script over everything; full suites + `typecheck:functions` + `copy:evaluate` + lock checker; ~2 fresh-generation spot checks. No previously passing cell may regress — including run-1's fixed i01/i02.

## 7. Rubric — unchanged from run 1

Same hard fails (fact drift; baked-in text/QR/logos; wrong subject/AI-slop; mechanical contrast <3:1 or unreadable text; truncation/overflow/collision; preview≠publish or nondeterministic render; KO/ES tofu/fallback fonts; no-image dead end) and the same seven 1–5 dimensions (stopping power, image craft, typographic hierarchy, legibility everywhere, color harmony, copy craft, layout/balance), scored against `ANCHORS.md` in all three surfaces. Pass bar: corpus mean ≥4.2, no dimension mean <3.5, no cell <3. Record per-cell latency, provider, retries, quota.

## 8. Levers — status after run 1

| Lever | Status |
|---|---|
| Renderer legibility (ink + scrim) | **Done** (`18afd6d7`) — don't reopen unless a run-2 cell fails contrast |
| V1-vs-V2 | **Decided** (V2 recommended) — don't re-litigate |
| Image prompt: full-bleed (P1) | **Done + deployed** — regression-guarded |
| Fallback size (P2) | **Done + deployed** — residual smoke pending |
| Server luma → adaptive scrim | **Open — Tier 0, first priority** |
| Copy craft gates (hookiness, kicker congruence) | **Open — Tier 1** |
| Template/palette polish, badge/margins | **Open — Tier 1** |
| Image prompt: composition/category craft | **Open — Tier 2** |
| Image-QA calibration | Open, evidence-gated only |
| Model params (gpt-image-1 quality tier, Gemini image_size) | Last resort, only if Tier 2 proves a model-side ceiling; log cost delta |

Per-change proof discipline is unchanged: same-content A/B (re-render for renderer levers, matched regen for image levers), side-by-side screenshots in the cell dir, judge only the affected dimensions, commit with cell ids.

## 9. Budget and stop criteria

- **Quota is the governing budget:** ~7 generations exist today; the full run wants ~25–30 → **Dan's out-of-band bump is a precondition for Tiers 2–3** (§4). Free tiers proceed regardless. Track used/30 in `SPEND_LOG.md` after every generation.
- **Dollar cap: $20** (unchanged; run 1 spent ~1 image). Text-only copy calls are cheap but still logged.
- Reserve: keep ≥4 generations for Tier 3 and ≥2 for Tier 4 — stop opening Tier-2 cells when the reserve would be breached.
- Max 3 improve-and-verify cycles, then report. Stop immediately on: any non-run data affected; deploy smoke failure + rollback exercised; device/Metro unrecoverable; anything needing a §2 gate.

## 10. Cleanup and end-of-run

1. All run-2 ledgered deals ended (verify none live), drafts/uploads/seeds removed, quota restored **only if the agent changed it** (a Dan-side bump is his to keep or revert — record final value either way), run-1 orphan smoke image disposed and marked in both ledgers.
2. `docs/ai-poster-core-lock.json` updated for every locked file touched; `node scripts/check-ai-poster-core-lock.mjs` passes (30/30 baseline from run 1).
3. Full validation sweep green (or failures explained).
4. `REPORT.md`: before/after gallery across the EXPANDED corpus, per-dimension deltas vs run-1 baseline scores, luma verified live, publishes/ends table, quota+spend, what still needs the rebuild (P3 renderer fix + V2 flip remain rebuild-gated regardless of run 2), ranked remaining gaps.
5. **Undo one-pager** at top: revert-list for run-2 commits, redeploy `a8e414fe` (run-2 rollback) with the full-unwind `798f63aa` option labeled as also-undoing-run-1, re-verify smokes. Note tooling/corpus as keepable.
6. Nothing pushed, no migrations, plan docs and run-1 artifacts untouched except where §3 says otherwise.

## 11. Traps (run-1 hardened list)

- New Metro route files need a full JS reload on Windows; the gallery already exists — prefer extending `lib/dev/poster-gallery-corpus.ts` over adding routes.
- No `functions logs` via CLI — design smokes so responses carry the evidence (e.g. assert `poster.luma` in the response body).
- The luma re-download gap: don't "fix" it by retrying the download — thread bytes (§5).
- F4 rescue costs ~100s before success — that latency is a legitimate friction finding in Tier 3, but the mechanism itself is fixed; don't re-diagnose it.
- Quota math before every paid cell; never touch the tainted service key.
- `gpt-image-2` stays allowlist-blocked; Gemini `response_format` 4:5 with one-shot 400 fallback stays; cooldowns are respected, not fought.
- ~~Feed shows the whole poster at 3:2 (13aee76e)~~ — **corrected in session 4 by measuring
  the real render: a deal with a poster spec shows the whole poster at 4:5, uncropped**
  (`PosterOfferTemplate` → `AdPosterCanvas`, fixed 1080×1350). The 3:2 belongs to the *image
  slot* of the non-poster templates (`split_offer_panel`, `live_drop_card`). Still judge the
  feed every time — just do not expect a 3:2 crop, and note the feed hides the merchant line
  for poster cards, so the poster's own business name is the only identity a shopper sees.
- Poster text limits (28/32/34) are visible product behavior — changing them is a report-level recommendation, not a casual edit.

## 12. Kickoff prompt (Dan pastes into a fresh Opus 4.8 max session)

> Read docs/plans/poster-ad-quality-harness.md and execute RUN 2 end to end. §1a is already done — do not repeat it. I approve the §2 standing authorization for this run: locked AI file edits without per-file stops, local commits continuing on qa/poster-ad-quality, and prod deploys of the in-scope functions with the rollback ledgers required (run-2 rollback target a8e414fe). Quota status: [I've bumped the monthly ad quota to N / not bumped — free tiers only]. Spend cap $20. Hard gates stay: no push, no migrations, no builds, no secrets, and never use the old pasted service key. Creds for the API tier are in .env.qa.local. End every test deal right after judging. Deliver the report with before/after against run 1 and the undo one-pager.

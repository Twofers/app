# First-Deal AI Quality Harness — operator brief for Opus 4.8 (max)

Status: PLAN — approved by Dan 2026-07-20 (chat). Execute only when Dan pastes the kickoff prompt in §12 into a fresh session.

## 1. Mission

A business owner using the app for the very first time must be able to produce a **quality, publishable deal** through any of the four input lanes, without dead ends:

1. **Menu item** they uploaded (menu scan/extract → pick item → offer)
2. **Template / quick create** path
3. **Their own photo** as the deal image
4. **Plain English** — they just type what they want

This harness tests all four lanes end-to-end on the real S10 + prod backend with real AI generation and real publishes, judges every result against the rubric in §7, fixes what fails, and re-verifies — while keeping every change trivially reversible (§3).

Definition of done: one full matrix pass with **zero hard fails** and scores at/above the pass bar (§7), OR budget/stop criteria reached (§9) with a report of what remains.

## 2. Authority and standing approvals (signed by Dan)

Dan grants this run **standing approval to edit the locked AI files** without stopping per-file, covering exactly the files enumerated in `docs/ai-poster-core-lock.json` (as of lockVersion 1, 2026-07-20), including but not limited to:

- `app/create/ai.tsx`, `app/create/ai-compose.tsx`, `app/create/menu-scan.tsx`, `app/create/menu-offer.tsx`, `app/create/quick.tsx`
- `lib/deal-offer-contract.ts` (+ tests), `lib/ad-spec.ts`, `lib/ad-variants.ts`, `lib/functions.ts`
- `lib/poster/*` (posterCopy, posterPolicy, posterTypes + tests), `components/poster/AdPosterCanvas.tsx` (+ tests), `components/poster/posterTemplates.ts`
- `supabase/functions/ai-generate-ad-variants/index.ts` + `prompt.ts` (+ tests)
- `supabase/functions/_shared/ai-image-provider.ts`, `_shared/dalle-image.ts` (+ tests), `_shared/ai-generate-ad-variants-poster-copy-source.test.ts`
- `fixtures/ai-poster-copy-offers.json`, `scripts/evaluate-ai-promotional-copy.mjs`
- Edge functions in scope for edit+deploy: `ai-generate-ad-variants`, `ai-compose-offer`, `ai-extract-menu`, `ai-generate-deal-copy`, `ai-deal-suggestions`, and `_shared` modules they import

Conditions of the grant (all mandatory):

- Every change lands as its own commit on the run branch (§3), message prefixed `[aiqa]`.
- `docs/ai-poster-core-lock.json` is updated at end of run for every locked file touched, with approvalRef `2026-07-20 Dan standing approval (first-deal AI quality harness run)` and a rationale describing the actual behavior change.
- Deal facts stay authoritative. Prompt/copy fixes must be generic — **never** example-specific string patches. Every prompt change updates fixtures + regression tests in the same commit. Deterministic fallback paths must survive every change. Provider failures must never leak raw upstream bodies or secrets.

**Still hard-gated — stop and ask Dan (these survive the blanket approval):**

- `git push`, merge, rebase, reset of shared branches; any remote write
- Supabase **migrations / `db push` / any DDL or schema change** (if a fix seems to need one, stop and propose it)
- Building release/production artifacts; store submission; version/build numbers; signing; keystores
- Changing any Supabase/Stripe/EAS secret; printing any secret, token, claim/redemption code, or QR value to chat/logs/commits
- Editing `CLAUDE.md`/`AGENTS.md`, RLS policies, billing/claim/redemption code, or anything outside the AI-lane scope above
- Deleting or modifying any data not created by this run (cleanup applies only to ledgered IDs, §10)

## 3. Rollback architecture — the "undo everything" contract

Everything the run does must be reversible in minutes. Four ledgers make that true, all living under `artifacts/ai-hardening/<YYYY-MM-DD>/`:

**3a. Code (git).**
- At start: record `BASELINE_SHA = git rev-parse HEAD` in `RUN_LEDGER.md`; save `git status --porcelain` output as `preexisting-wip.txt`. The working tree currently carries Dan's unrelated WIP (modified files on `qa/db-guardrails-and-auth-tests`) — those files are **untouchable**: never staged, committed, reverted, or overwritten. If a fix needs one of them, stop and ask.
- Create branch `qa/ai-first-deal-hardening` from HEAD. All run commits go there, one commit per fix, `[aiqa]` prefix, staging only files the run itself touched (`git add <explicit paths>`, never `-A`).
- Undo one fix: `git revert <commit>`. Undo all code: `git checkout qa/db-guardrails-and-auth-tests` (WIP files were never committed, so they're intact).

**3b. Edge function deploys (`DEPLOY_LOG.md`).**
Prod functions serve real businesses the moment they deploy. Therefore: deploy only tested fixes (never experiments), and for every deploy append a row: `timestamp | function | deployed-from commit | rollback SHA (previous deployed state, initially BASELINE_SHA) | post-deploy smoke result`. Immediately after each deploy, run a direct smoke call before device retesting.
**Kill switch (restore all functions to baseline):** for each function in the log, from a clean worktree of the rollback SHA — `git worktree add ../aiqa-rollback <SHA>` then, from *inside* that worktree dir (deploys must run from the directory being deployed), `supabase functions deploy <fn> --project-ref <prod ref>`. Target: all functions restored in under 5 minutes.

**3c. Data (`DATA_LEDGER.md`).**
Every row/object the run creates gets a ledger line at creation time: deals (id, published at, ended at), menu items, uploaded storage objects (bucket/path), drafts, and any admin-panel value temporarily changed (old value → new value → restored at). Cleanup (§10) walks this ledger — nothing outside it is ever touched.

**3d. Spend (`SPEND_LOG.md`).**
Running total per generation call (see §9). Hard stop at the cap.

## 4. Environment and session setup

- Device: Samsung S10 (`SM_G973U1`), production package `com.unvmex2.twoforone` (dev-client build) against **prod Supabase**. Launch recipe: `adb reverse tcp:8081 tcp:8081`, start Metro (`EXPO_NO_METRO_LAZY=1 npx expo start --dev-client`), open via deep link `twoforone://`. Client JS/TS changes hot-load through Metro — no rebuild needed, and nothing ships to real users (they run the store bundle). Native/config changes are out of scope (would need a rebuild — park and report instead).
- Screenshots: use the `sh` skill (screencap can render black on this device; `uiautomator dump` for view hierarchy; `adb shell input keyevent 26` if touch stops responding).
- Account: the business account **already signed in on the S10**. At run start, record its business id + user id in `RUN_LEDGER.md` (needed for ledger scoping and API-tier calls). Dan provides that account's email/password in `.env.qa.local` at repo root for API-tier auth — verify the file is gitignored before writing anything to it; never echo its contents.
- Capability preflight: call the activation-gate (`get_business_capabilities` via the app or `lib/functions.ts` shapes) to confirm the account can generate + publish and has credits. If a per-business AI quota/cooldown/credit cap would block the matrix, an admin-side **data** adjustment for this one business is allowed if ledgered with the old value and restored at end of run (schema changes remain forbidden). Respect generation cooldowns (`COOLDOWN_ACTIVE` 429 carries `wait_seconds`) — pace cells rather than hammering.
- Evidence layout: `artifacts/ai-hardening/<date>/<tier>/<cell-id>/` holding screenshots, fn responses, generated images, judge JSON. Per the repo's QA-screenshot exception, on-screen QR/claim codes may appear in local artifacts but must never be transcribed into chat, commits, or reports.

## 5. Lane → code map (starting points; verify at run start, code wins over this doc)

| Lane | Client entry | Server path |
|---|---|---|
| 1. Menu item | `app/create/menu-scan.tsx` (upload/scan → `ai-extract-menu`), `app/create/menu.tsx` / `menu-manager.tsx` / `menu-offer.tsx` (pick item → offer) → `app/create/ai.tsx` | `ai-extract-menu`, then `ai-generate-ad-variants` |
| 2. Template / quick | `app/create/quick.tsx` + the fallback/composed template flow inside `app/create/ai.tsx` (`useFallbackTemplateAd`, `components/composed-ad-card/templates/*`) | `ai-generate-ad-variants` (or deterministic template, no image spend) |
| 3. Own photo | `app/create/ai.tsx` (`pickPhotoFromLibrary` → photo as final/base image) | `ai-generate-ad-variants` (copy + QA on merchant photo) |
| 4. Plain English | `app/create/ai-compose.tsx` (typed text → `ai-compose-offer`) and the free-text hint inference in `ai.tsx` (`mergeInferredEligibilityForm`, `lib/deal-eligibility-inference.ts`) | `ai-compose-offer` → `ai-generate-ad-variants` |

Voice compose is **out of scope** for this run (Dan listed typed input only). `ai-create-deal` is legacy and must keep returning 410.

Pre-seed the device for lanes 1 and 3 before the matrix: a small set of menu photos/PDFs and 4–6 realistic "owner phone photos" (food plate, storefront, product on counter, dim/low-quality shot) pushed to the S10 camera roll (`adb push` + media scan) — ledger the pushed files for cleanup.

## 6. Test matrix

Fixture dimensions (compose cells from these; full cross-product not required):

- **Business/cuisine variety** (guards against category bias — the old coffee-bias class of bug): taqueria, Korean BBQ, nail salon, pizza shop, boba/tea, barbershop, diner. Use the signed-in business's real profile but vary the *offer/item* content across these registers.
- **Offer shapes**: BOGO (same item), buy-X-get-Y-free (different reward), percent-off, free-item-with-purchase, spend-threshold.
- **Input quality**: clean; terse ("bogo tacos tuesdays"); messy (typos, ALL CAPS, emoji, trailing punctuation, unmatched quotes, parenthetical descriptions with hype words — the historical killers); item names with Spanish diacritics and Korean text.
- **Locale**: EN every cell; ES and KO sampled (≥3 cells each) — owner-language screens + translated deal copy.

**Tier 0 — Baseline smoke (device, no fixes yet):** one journey per lane, publish + end. Establishes latency baselines and whether any lane is broken outright. ~4 cells.

**Tier 1 — API breadth sweep (fast, cheap):** direct authenticated calls to `ai-compose-offer` (parse quality) and `ai-generate-ad-variants` (copy + image + poster spec) using the exact request shapes the client sends (mirror `lib/functions.ts`). ~20–24 cells covering every offer shape × input-quality variant, ES/KO samples, and edge inputs. Judge from the raw responses + downloaded images. This finds most quality problems at lowest cost.

**Tier 2 — Device E2E depth:** 10–12 full first-time-owner journeys across the four lanes (every lane × at least 2 offer shapes), each through: input → generate → preview → (refine once where natural) → publish → verify the published deal row + owner-side live view → **end the deal immediately after judging** (Dan's decision). Capture screenshots at each step. Also judge *friction*: taps to first preview, unclear errors, cooldown walls, dead ends.

**Tier 3 — Fix & regress:** after each fix (§8), re-run the failing cell(s) plus a 4–6 cell sample of previously passing ones (always covering the lane touched). A fix that breaks a passing cell is reverted or reworked before moving on.

Failure/fallback behavior is verified at the unit/test level (existing suites + new regression tests), **not** by deploying broken experiments to prod. Only judge live fallbacks when they trigger naturally.

## 7. Judging rubric

Judge every cell with fresh eyes (Opus multimodal on screenshots/images + mechanical checks), writing a structured JSON verdict per cell into the cell's artifact dir.

**Hard fails (any one fails the cell and demands a fix):**

- **Fact drift**: headline/subheadline/kicker/terms/deal row contradict or alter the intended offer facts (mechanically diff the published deal row against the fixture facts — script it: fetch by id with owner/anon read, compare item names, quantities, percent, reward, schedule).
- **Baked-in text/QR/logo in a generated image** (native renderer owns all text; pixels must be clean).
- **Wrong-subject image** (taco deal → burger photo) or grotesque artifact (mangled food, warped text-like shapes).
- **Dead end**: owner reaches a state with no forward path (generation gives up without offering the deterministic fallback/template; publish blocked with no actionable message; crash).
- **Validation bypass**: a deal publishes that violates poster policy / offer contract.
- **Silent merchant-input loss**: an edited or typed value the owner provided is dropped or reverted at publish.

**Scored 1–5 (record all; pass = median ≥4 across the matrix, no cell <3):**

1. Headline explains the customer action + reward naturally (locked product rule).
2. Kicker/subline congruent with the actual item, business type, and daypart (no category bias).
3. Image appeal + relevance (would a real owner proudly publish this?).
4. Copy↔image coherence as a single ad.
5. ES/KO copy quality where sampled: native-sounding, correct diacritics/particles, not machine-literal.
6. First-time friction: time-to-first-preview, tap count, clarity of every error/wait state encountered.

**Latency:** record per-stage timings every cell (compose parse, copy, image, publish). Flag p90 regressions vs the Tier 0 baseline; a generation that exceeds the edge worker limit or leaves the owner staring >90s without progress feedback is a finding even if output is good.

## 8. Improve loop protocol

For each confirmed failure:

1. **Classify the layer**: prompt (`prompt.ts`) | offer contract/validation (`lib/deal-offer-contract.ts`, poster policy) | provider/image (`_shared/ai-image-provider.ts`, `dalle-image.ts`, image QA) | client UX (`app/create/*`) | fallback path. Diagnose with logs/responses before editing.
2. **Smallest correct fix** at that layer. Rules from §2 apply (generic fixes only, fixtures + regression tests in the same commit, fallback preserved, facts authoritative).
3. **Validate locally**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run typecheck:functions` (when functions changed), `npm run copy:evaluate` (any prompt/copy change), plus the focused suites for touched files. `node scripts/check-ai-poster-core-lock.mjs` will flag locked-file hash changes — that's expected under this run's standing approval; update the lock manifest at end of run (§2), don't bypass the checker any other way.
4. **Ship**: client changes hot-load via Metro (session-local, zero user exposure). Function changes deploy per §3b with an immediate smoke call, then device recheck.
5. **Re-judge** the failing cell, then run the Tier 3 regression sample. Commit with a message naming the cell(s) fixed.
6. **Log** in `RUN_LEDGER.md`: finding → root cause → fix commit → deploy row (if any) → retest verdict.

## 9. Budget, iteration, and stop criteria

- **Spend cap: $20 for the run** (Dan's decision). Track real spend from the `ai_generation_costs` ledger where readable (sum rows for this business since run start) plus a conservative local estimate per image call (~$0.10–0.25). Append to `SPEND_LOG.md` after every generating cell. At $16 (80%), stop opening new cells and reserve the rest for retests; at $20, stop generating entirely and write the report.
- Respect cooldowns between generations; never disable them globally (a per-business ledgered adjustment per §4 is the only allowed relaxation).
- Maximum 3 full improve-and-retest cycles, then report regardless of pass bar.
- Stop immediately and report if: any real (non-run) user data looks affected; a deploy smoke fails and rollback was exercised; the S10 or Metro session becomes unrecoverable; or a needed fix requires anything §2 gates.

## 10. Cleanup and end-of-run checklist

1. Every ledgered deal is **ended** (already continuous — verify none still live; ending, not hard-deleting, is the reversible choice). Every ledgered draft removed, storage upload deleted, pushed camera-roll seed files removed from the device, and any temporarily adjusted admin value restored (verify against recorded old values).
2. `docs/ai-poster-core-lock.json` updated for every locked file touched (new sha256, approvalRef per §2, honest rationale). Re-run `node scripts/check-ai-poster-core-lock.mjs` → must pass.
3. Final validation sweep: typecheck, lint, test, typecheck:functions, copy:evaluate — all green (or failures explained in the report).
4. `REPORT.md` in the run's artifact dir: matrix heatmap (before/after scores per cell), every hard fail found and its fix, every commit (`git log --oneline qa/ai-first-deal-hardening ^BASELINE_SHA`), every deploy with rollback SHA, total spend, deals published/ended count, ES/KO findings, remaining risks + recommended next run.
5. **Undo one-pager** at the top of the report: the exact commands to (a) revert all `[aiqa]` commits, (b) redeploy every touched function from `BASELINE_SHA` via the §3b worktree procedure, (c) re-verify with the smoke calls. Dan must be able to execute it by pasting.
6. Nothing is pushed. No migrations were applied. Dan's pre-existing WIP files match `preexisting-wip.txt` exactly (`git status` diff to prove it).

## 11. Known traps (from prior runs — read before starting)

- Deploys must run from inside the directory/worktree being deployed, or stale code ships.
- `expo run`/Metro on this AVD-and-device setup wants `EXPO_NO_METRO_LAZY=1`; plain screencap can capture black — use the `sh` skill / uiautomator.
- BOGO contracts: reward-item contamination from the free-text parser was a real publish-blocker (fixed 2026-07-20 in `lib/deal-offer-contract.ts`); `ai-generate-ad-variants` must be redeployed for server-side pickup if not already — verify at Tier 0.
- Item names with parentheticals/hype-words and unmatched quotes historically caused `COPY_FAILED` — they're in the matrix on purpose.
- The image pipeline is Gemini-primary with OpenAI `gpt-image-1` fallback (`gpt-image-2` is intentionally allowlist-blocked; do not re-add).
- Legacy `ai-create-deal` must keep returning 410.

## 12. Kickoff prompt (Dan pastes this into a fresh Opus 4.8 max session)

> Read docs/plans/first-deal-ai-quality-harness.md and execute it end to end. I approve the standing authorization in its §2 for this run — including edits to the locked AI files listed there without per-file stops, local commits on qa/ai-first-deal-hardening, and prod deploys of the in-scope edge functions with the rollback ledger it requires. Spend cap $20. The hard gates in §2 stay: no push, no migrations or schema changes, no builds, no secrets. My login for the API tier is in .env.qa.local. End every test deal right after judging it. When you're done, give me the report and the undo one-pager.

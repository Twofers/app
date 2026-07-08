# AI Image — Gemini Activation + Frugal Generation Plan

Date: 2026-07-07
Prepared by: Fable 5 (read-only audit). Status: awaiting Dan's approval.
Goal: generate deal images with Gemini (as the v1 code already supports), one image per
creation, no change to the copy stack, minimize AI spend.

## What v1 actually does today (audited)

- **Image generation: OpenAI `gpt-image-1` at `quality: "high"`.** Documented in `.env.example`
  as `AI_IMAGE_PROVIDER=openai`, `AI_IMAGE_GEMINI_ENABLED=false`. (Production Supabase secrets
  were not inspected; confirm the live values match before relying on this.)
- **Gemini is already live in the v1 image path — for QA, not generation.** Commit
  `4a9c20f9` (2026-07-03) routed image vision-QA and menu OCR onto Gemini. So Google already
  receives generated images today to verify required items.
- **A complete, tested Gemini image *generation* provider already exists in v1 code**, added in
  `a7afd4a9` (2026-06-20) and fixed in `1d6eabdc` / `060a84f2`. It lives in
  `supabase/functions/_shared/ai-image-provider.ts` and is fully wired into
  `supabase/functions/ai-generate-ad-variants/index.ts`. It is feature-flagged **off**.

So "use Gemini for images like v1" = **turn on an existing, tested provider**, not build one.

## Why this also serves frugality

- Gemini flash tier `gemini-3.1-flash-image`: **~$0.067 / image** (config default
  `GEMINI_IMAGE_ESTIMATED_COST_1K_USD = 0.067`).
- OpenAI `gpt-image-1` at high: **~$0.13–0.17 / image**.
- Net: **~55–60% cheaper per generated image**, and Gemini renders native 4:5 (no crop).
- Copy generation stays on `gpt-5.4-mini` — untouched. The 5-drafts-in-one-call quality gate
  (the natural-copy mechanism) is untouched. Item research + web lookup untouched.

---

## Part A — Activate Gemini image generation (config only, no code, no deploy)

Set these Supabase Edge secrets (Dashboard → Edge Functions → Secrets):

| Secret | Value | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `<your Google AI key>` | Required. Hosted secret only — never commit. |
| `AI_IMAGE_GEMINI_ENABLED` | `true` | Master switch (default false). |
| `AI_IMAGE_PROVIDER` | `gemini` | Primary generator (default openai). |
| `GEMINI_IMAGE_MODEL` | *(leave unset)* | Defaults to `gemini-3.1-flash-image` (flash tier). |
| `AI_IMAGE_FALLBACK_PROVIDER` | *(leave unset)* | Defaults to `openai` — gpt-image-1 stays as the automatic safety net if Gemini fails. |

Leave everything else at defaults:
- `AI_IMAGE_OWNER_PHOTO_REFERENCE_ENABLED` (default true) — owner-uploaded photos are used as a
  reference for Gemini edits.
- `AI_IMAGE_STOCK_FALLBACK_ENABLED` (default true).
- **Do NOT set** `AI_TEXT_FALLBACK_ENABLED` — copy stays 100% OpenAI. This is a separate gate and
  must stay off.

No repo files change in Part A. No edge-function deploy is required — these are runtime secrets
read by the already-deployed function.

**Restore (Part A):** set `AI_IMAGE_GEMINI_ENABLED=false`. Back to OpenAI generation in ~1 minute,
no deploy.

### Privacy gate before Part A goes to production (Dan's to clear)

`docs/ai-google-data-flow.md` requires the public privacy/subprocessor disclosure to be updated
before Gemini is fully activated in production, because generation sends merchant business/offer
facts — and, when the owner uploads a photo, that photo — to Google. The exact approved wording is
already drafted in that doc ("Public Privacy/Subprocessor Copy For Dan").

Context for the decision: Gemini image *QA* already sends generated images to Google in live v1,
so Google already processes deal imagery today; generation adds the offer facts and owner photos.
Clearing the disclosure is the clean path. This step is Dan's, not the agent's.

---

## Part B — Cap to one image per creation (code, recommended companion)

Today, on a multi-item deal (e.g. buy bagel → free coffee), if QA can't see both items in the
first image, the server silently generates a **second full image** and re-checks it. This happens
on **both** providers:

- OpenAI path: `supabase/functions/ai-generate-ad-variants/index.ts` ~lines 2370–2413
  (`image_generation_retry`).
- Gemini path: same file ~lines 2917–2969 (`image_generation_retry`).

Add one env-gated cap so a QA miss never buys a second image; it keeps the first image (or falls
back to copy-only / stock per existing policy) instead.

- New flag: `AI_IMAGE_MAX_GENERATIONS_PER_REQUEST` (integer, default `2` = today's behavior).
  Set to `1` in production to disable the QA-triggered regeneration.
- Behavior when `1`: skip both `image_generation_retry` blocks; the first generated image is
  used if it passes hard-fail checks, otherwise the existing safe fallback path runs. QA still
  *runs once* (it's cheap and it's what blocks a genuinely bad image), it just never triggers a
  second paid generation.
- Not affected: the Gemini provider's internal simplified-prompt retry
  (`generateGeminiAdImageWithTelemetry` `retryOnFailure`) only fires when the first attempt
  returns **no image at all** (a hard failure), not on a QA miss — that's resilience, not a
  double-spend, and it produces no image to pay for when the first already succeeded. Leave it.

### Lock approval request for Part B (per `docs/ai-poster-core-lock.md`)

| File | Change | Owner/customer-visible effect | Validation | Deploy |
|---|---|---|---|---|
| `supabase/functions/ai-generate-ad-variants/index.ts` (LOCKED) | Gate both `image_generation_retry` blocks behind `AI_IMAGE_MAX_GENERATIONS_PER_REQUEST >= 2`; default preserves current behavior | With flag `1`: multi-item deals whose first image misses an item show the first image or the existing fallback instead of a retried image. No change at default. | `npm run typecheck:functions`, focused source test for the cap, `npm run gate:ai-poster-lock` | Edge deploy of `ai-generate-ad-variants` (hard-gated — Dan approves separately) |
| `docs/ai-poster-core-lock.json` | Update `index.ts` sha256 + approvalRef after the approved edit | none | `npm run gate:ai-poster-lock` | none |
| `.env.example`, deploy docs (NOT locked) | Document the new flag + the Gemini secrets | none | — | none |

**Restore (Part B):** set `AI_IMAGE_MAX_GENERATIONS_PER_REQUEST=2` (or unset). No redeploy needed
to restore since the default already equals today's behavior; a redeploy is only needed to ship
the flag the first time.

---

## Cost impact (per deal creation, typical)

| | Today (OpenAI high) | Part A (Gemini flash) | Part A + B |
|---|---|---|---|
| Single-item deal | ~$0.19 | ~$0.10 | ~$0.10 |
| Multi-item deal that retries the image | ~$0.36 | ~$0.17 | ~$0.10 |
| Copy quality | baseline | unchanged | unchanged |

(Copy + research + one QA pass are ~2–4¢ combined and unchanged in every column; the movement is
almost entirely the image.)

## Validation summary

- Part A: no code — verify by generating 3–5 deals in dev with the secrets set, confirm
  `ai_generation_costs` rows show `provider: gemini`, and the poster fills 4:5 with no side-crop.
- Part B: `npm run typecheck:functions`, a focused source test asserting the retry is skipped at
  `1` and preserved at default, `npm run gate:ai-poster-lock` green.
- No prompt changes → `copy:evaluate` fixtures untouched.

## Restore card

| Change | Restore |
|---|---|
| Gemini image generation | `AI_IMAGE_GEMINI_ENABLED=false` (secret; ~1 min, no deploy) |
| One-image cap | `AI_IMAGE_MAX_GENERATIONS_PER_REQUEST=2` or unset (default already = old behavior) |
| Everything | No migrations, no schema changes, no copy-stack changes; OpenAI remains the auto-fallback generator throughout |

## Open decision for Dan

1. Approve **Part A only** (Gemini generation), or **Part A + Part B** (recommended — the cap is
   where the multi-item double-spend actually gets removed)?
2. Clear the privacy disclosure first, or accept the disclosure risk for the pilot and clear it in
   parallel? (Agent will not flip the prod secret until you say which.)

---

## Implementation status (2026-07-07, on-device QA session)

This section was added while completing the deal-creation / ad-quality / publishing pass. It records
what shipped, what's ready, and how the plan connects to the launch-audit findings
(`qa-artifacts/final-launch-audit/FINDINGS.md`).

### Why this plan matters more than "cost" right now

On-device testing this session reproduced **F-002** repeatedly: text-only AI generation fails to
produce an image on roughly **1 of every 2 attempts** ("AI couldn't create an image…"), then
succeeds on retry with identical input. Today's generator is **OpenAI `gpt-image-1`** (per Part A
audit), with Gemini only doing QA. So the flaky leg is the OpenAI image call. **Part A (make Gemini
flash the primary generator, keep gpt-image-1 as the automatic fallback) is therefore not just a
~55% cost cut — it directly targets the F-002 reliability problem** by moving off the leg that's
failing and keeping the old one as a safety net. Recommend Part A be treated as an F-002 mitigation,
not only a frugality change.

### Done this session (non-locked, committed)

- **F-026 — publish unblocked for free-item / same-item BOGO deals.** A valid "buy any muffin, get
  one free" could not publish: the client publish gate `lib/deal-quality.ts` (`assessDealQuality`,
  the only caller is `app/create/ai.tsx:3426`; **not** enforced server-side — the SQL/edge
  `is_strong_deal_offer` guard already passes any free-item deal, and `set_quality_tier_on_deal`
  only sets a ranking column) did not recognize the app's **own** canonical terms wording
  "Purchase X **to receive** one Y **free**" (`lib/deal-offer-contract.ts:607`) — its patterns
  keyed on "get", "bogo", "second item free", not "receive". Added a canonical-terms pattern
  (EN + ES) to `MEANINGFUL_FREE_PATTERNS`; +regression test; typecheck / lint / **1280 tests** green.
  No migration, no deploy, no locked file. This is the fix for why some AI-created BOGOs silently
  refused to publish.

### Ready, needs Dan (locked + hard-gated)

| Item | Where | Gate |
|---|---|---|
| **Part A** — Gemini primary image generation | Supabase Edge **secrets** (`AI_IMAGE_GEMINI_ENABLED=true`, `AI_IMAGE_PROVIDER=gemini`, `GEMINI_API_KEY`) + privacy-disclosure clear | Dan sets secrets; not an agent action. No code. |
| **Part B** — one-image cap | LOCKED `supabase/functions/ai-generate-ad-variants/index.ts` (gate both `image_generation_retry` blocks behind `AI_IMAGE_MAX_GENERATIONS_PER_REQUEST>=2`, default preserved) | Per-file lock approval → edit + `docs/ai-poster-core-lock.json` sha bump + `gate:ai-poster-lock` + `typecheck:functions`; **hard-gated edge deploy** = Dan. |
| **F-002 (deeper)** — erratic image item-QA verdicts + copy-only fallback | LOCKED `ai-generate-ad-variants/index.ts` (Stage 3) | Own investigation; Part A likely mitigates the flaky leg first. Per-file approval + deploy. |
| **F-024** — poster "Try our any muffin" eyebrow | LOCKED `app/create/ai.tsx:1297` + `components/poster/AdPosterCanvas.tsx:207` | Per-file approval + lock sha bump + fixtures; rebuild (no deploy). |
| **F-006** — recovered-draft past start shown | LOCKED `app/create/ai.tsx:1841` | Per-file approval + lock sha bump; rebuild (no deploy). |

**Restore** for every locked item is the same as documented above (flags default to today's behavior).

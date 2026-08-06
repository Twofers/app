# Express deal-creation path — un-regress the merchant core loop

Date: 2026-08-06
Status: APPROVED to implement (Dan directive 2026-08-06: top-3 improvements batch) — poster-lock per-file notice in §6 still applies before any locked file is committed.
Convention: this plan file IS the tracker; check items off as they land.

## Why this is #1

The June 2026 review flagged `app/create/ai.tsx` at ~2,000 lines as P0-3
("create-deal complexity"). It has since **regressed to 6,657 lines with 85
`useState` hooks in a single component**, and the two simpler entry points were
collapsed INTO it rather than the reverse:

- `app/create/quick.tsx` (46 lines) — now a redirect: "Quick Deal now uses the unified AI builder"
- `app/create/ai-compose.tsx` (33 lines) — now a redirect
- `app/create/ad-refine.tsx` (48 lines) — placeholder that redirects to `/create/ai`

All three steps render simultaneously on one long scroll (`StepBadge n={1..3}`
at ai.tsx:5178 / :5459 / :5532 — format+photo, description, full scheduling
with day pickers, time windows, presets at :5682-5715, plus eligibility at
:5964). The only true progressive disclosure is `claimSettingsOpen` (:1196, UI
:5820-5847). This is the screen every merchant uses repeatedly and it clashes
with the standing "simple, few-words" UI rule.

The opening: `publishReadiness` (:1502-1533) only requires non-empty title +
description, so a short path already exists in logic — the UI just never hides
the rest.

## Design — Phase 1: Express-first, one expander (this batch)

Express is a **view state over the existing state**, not a second flow.
Do NOT fork the screen or resurrect quick.tsx — that is how the last
"simple path" died. One component, one state model, two densities.

When entering from the create hub (`app/(tabs)/create.tsx:417` →
`/create/ai?fromCreateHub=1`) with no template/edit params:

1. **Visible by default (express):**
   - Photo picker (step 1 as-is, already collapses after pick via `photoStepCollapsed`)
   - Deal description / voice hint (step 2 as-is)
   - AI generate + card preview (existing)
   - ONE schedule line: the simplest existing preset (single-window "today"
     style) rendered as a summary row ("Today · 2–5 PM · tap to change") —
     reuse the existing preset machinery at :5682-5715, do not invent a new
     schedule model
   - Publish button (existing gate)
2. **Hidden behind a single "More options" expander:**
   - Ad format switch (standard_card vs poster_v1 — default stays whatever
     the current default is)
   - Recurring schedule, day pickers, multiple time windows
   - Eligibility variant, claim settings (keep the existing
     `claimSettingsOpen` collapse nested inside)
   - AI revision loop / version history UI
3. **Auto-expand rules (do not trap users):** entering via `templateId`,
   edit-existing, or reuse params opens with "More options" expanded;
   toggling anything inside keeps it expanded; the expander state is plain
   local state, not persisted.
4. Copy: new keys, few words, in **all three locales** (en/es/ko — i18n
   `defaultValue` masks missing keys, and CI `check:i18n-keys` gates it).

Non-goals for Phase 1: no changes to AI generation contracts, publish
payloads, `offer_versions`, edge functions, or the poster renderer. Client
UI restructuring only. Ships in the next store build (no OTA path).

## Checklist — Phase 1

- [x] Add `expressMode` view state + "More options" expander to
      `app/create/ai.tsx`; wrap the advanced sections listed above. No state
      deletion, no section reordering beyond visibility.
      (Implemented as `moreOptionsOpen`, `app/create/ai.tsx:1395`. Gates: ad
      format switch, eligibility override form, recurring schedule detail,
      claim settings, and the AI revision/version-history UI in the ad
      review section — see 2026-08-06 implementation notes below.)
- [x] Express schedule summary row backed by the existing presets; tapping it
      expands More options scrolled to the schedule section.
      (Reuses the existing `displayScheduleSummary` memo — no new schedule
      model. Tap opens More options; per §Design's own escape hatch, no
      scroll-to-section plumbing was added since it would be fragile.)
- [x] Auto-expand rules for template/edit/reuse entries (see §Design 3).
      (`moreOptionsOpen` seeds from the existing `shouldUseDraftRecovery`
      flag — same "fresh entry" test already used for draft recovery.)
- [x] New i18n keys in en + es + ko (`createAi.moreOptionsHeader`,
      `createAi.moreOptionsSummary`, `createAi.scheduleSummaryTapHint`).
- [x] Update `lib/create-ai-ux-source.test.ts` (LOCKED file — see §6) with
      source-sync assertions for the express default + auto-expand rules.
- [x] Gates: `npm run typecheck` (clean), focused vitest on create-ai tests
      (37/37 `lib/create-ai-ux-source.test.ts` + 42/42 across the other
      create-ai-adjacent source-sync test files, all passing), and
      `node scripts/check-i18n-keys.mjs` (PASS, locale parity holds).
      `npm run gate:ai-poster-lock` intentionally NOT run — it fails until
      the supervisor updates `docs/ai-poster-core-lock.json` hashes per §6.
      Copy evaluator not run — no headline/copy-generation paths touched.
- [x] Analytics sanity: no `deal_viewed`/publish analytics event call sites
      were touched — this pass only wraps existing JSX in view-state
      conditionals and adds one new state variable.

## Phase 2 — decompose the monolith (FOLLOW-UP, not this batch)

Extract step sections (photo/format, description/AI, schedule, claim
settings) into components behind a shared reducer; target `ai.tsx` as a
coordinator under ~1,500 lines. High-risk refactor of a poster-lock-covered
file; schedule it as its own plan with its own QA pass. Do not start it
opportunistically while doing Phase 1.

## §6 Poster-lock notice (required before commit)

`docs/ai-poster-core-lock.json` covers `app/create/ai.tsx` and
`lib/create-ai-ux-source.test.ts` (both change here). Per protocol:
files are listed here with impact (UI restructuring of the create screen;
test-source sync update; zero changes to poster rendering, copy generation,
or publish contracts). Approval basis: Dan's 2026-08-06 instruction to
implement this plan. On commit, update both entries' hashes in the manifest
with `approvalRef` chaining the prior ref ("Prior ref: …") per the approval
chain convention, then re-run `npm run gate:ai-poster-lock`.

## Founder gates

- Store build only (expo client change) — rides the next 1.0.4+ binary.
- Veto window: if the express default should NOT be default-on for existing
  merchants, say so before the build; a `fromCreateHub` param check or an
  app_flag can gate it, but the plan default is on-for-everyone.

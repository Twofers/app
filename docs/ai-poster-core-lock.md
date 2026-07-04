# AI Poster Core Lock

Date locked: 2026-07-03
Owner approval required from: Dan

This locks the current AI poster/ad-generation behavior as a core product feature.

## Locked Behavior

- AI creates the poster concept from the merchant's entered deal details, selected format, schedule, and available business context.
- Critical offer facts remain authoritative and app-rendered from locked deal data.
- Generated images stay text-free; the app renders business name, poster headline/kicker, offer lines, and redeem-by copy natively over the image.
- Poster offer facts stay in the poster artwork area, not in a separate black CTA/redeem strip.
- The poster top and bottom text areas should visually match the approved coffee/cookie poster direction.
- Poster kicker text is AI-selected from the specific product, customer moment, merchant context, or deal angle, not hardcoded to a generic phrase such as "Try our."

## Approval Gate

Before changing anything in the protected scope, the agent must stop and get Dan's explicit approval for each file individually.

For every file, the agent must state:

- the exact file path,
- what will change,
- how the owner/customer-visible behavior can change,
- what validation will be run,
- whether a hosted Edge Function deploy or app rebuild will be needed.

Approval must be explicit per file. A broad request like "fix AI", "update posters", or "continue" does not unlock this area unless Dan specifically approves the named file changes.

## Protected Scope

The lock applies to AI poster/ad-generation behavior, including:

- `app/create/ai.tsx`
- `components/poster/`
- `components/composed-ad-card/templates/PosterOfferTemplate.tsx`
- `lib/poster/`
- `lib/ad-spec.ts`
- `lib/ad-variants.ts`
- `lib/deal-offer-contract.ts`
- `lib/functions.ts` when changing AI ad request/response behavior
- `supabase/functions/ai-generate-ad-variants/`
- `supabase/functions/_shared/ai-image-provider.ts`
- `supabase/functions/_shared/dalle-image.ts`
- poster/ad prompt fixtures and promotional-copy evaluation scripts
- `docs/ai-poster-core-lock.json`
- `scripts/check-ai-poster-core-lock.mjs`
- `lib/ai-poster-core-lock.test.ts`
- AGENTS/CLAUDE rules that mention this lock

## Hash Lock

`docs/ai-poster-core-lock.json` stores normalized SHA-256 hashes for the clean core files currently locked.

Run:

```powershell
npm run gate:ai-poster-lock
```

`npm test` also runs this gate through `pretest`, and `lib/ai-poster-core-lock.test.ts` checks that the pretest hook remains wired.

If a protected file changes without an updated approval record, the gate fails and prints the required approval process.

## Updating After Approved Changes

After Dan approves a specific file change:

1. Make only the approved change.
2. Update that file's `sha256`, `approvalRef`, and rationale in `docs/ai-poster-core-lock.json`.
3. Run `npm run gate:ai-poster-lock`.
4. Run the relevant AI/poster checks, usually `npm run typecheck:functions`, focused tests, and `npm run copy:evaluate`.
5. Deploy only if Dan separately approves any hosted deploy required by the change.

## Current Snapshot

The current lock is based on these commits:

- `f87ca70c Refine AI poster ad generation`
- `4b72c207 Discourage generic poster kicker copy`

Some broader poster-related files already had unrelated uncommitted local changes when this lock was created, so they are covered by the approval policy even when not included in the hash manifest yet. Do not silently edit or clean them up.
